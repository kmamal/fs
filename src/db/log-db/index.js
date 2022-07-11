const Fs = require('fs')
const Fsp = Fs.promises
const Path = require('path')
const { exists: doesExist } = require('../../exists')
const { LockFile } = require('../lock-file')
const { Sequential } = require('../sequential')
const Constants = require('../constants')

const PB = Constants.POINTER_BYTES

const LOCK_FILE_NAME = 'lock'
const DATA_FILE_NAME = 'data'
const INDEX_FILE_NAME = 'index'

class LogDB {
	constructor (location) {
		this._location = location
		this._lockFile = new LockFile(Path.join(location, LOCK_FILE_NAME))
		this._locationData = Path.join(location, DATA_FILE_NAME)
		this._locationIndex = Path.join(location, INDEX_FILE_NAME)

		this._state = Constants.STATE.CLOSED

		this._dataLength = null
		this._indexLength = null

		this._dataFd = null
		this._indexFd = null

		this._sequence = new Sequential()
	}

	get location () { return this._location }

	get state () { return this._state }

	get dataBytes () { return this._dataLength }
	get indexBytes () { return this._indexLength }
	get bytes () { return this.dataBytes + this.indexBytes }
	get length () { return this._indexLength / PB - 1 }

	async open (options = {}) {
		const {
			truncate = false,
			create = true,
			validate = true,
			fix = false,
		} = options

		if (this._state !== Constants.STATE.CLOSED) {
			const error = new Error("Cannot call open from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		await Fsp.mkdir(this._location, { recursive: true })
		this._lockFile.acquire()

		this._state = Constants.STATE.OPENING

		// TODO: race condition
		let exists = true
			&& await doesExist(this._location)
			&& await doesExist(this._locationIndex)
			&& await doesExist(this._locationData)

		if (!exists && !create) {
			const error = new Error("not found")
			error.code = Constants.ERROR.MISSING
			error.path = this._location
			throw error
		}

		if (exists && truncate) {
			await Promise.all([
				Fsp.unlink(this._locationData),
				Fsp.unlink(this._locationIndex),
			])
			exists = false
		}

		await this._openFds()

		const buffer = Buffer.allocUnsafe(PB)

		if (!exists) {
			buffer.fill(0)
			await this._indexFd.appendFile(buffer)
			await this._indexFd.datasync()
			this._indexLength += PB
		} else if (validate) {
			let indexOffset = 0
			let lastDataPointer = 0

			try {
				if (this._indexLength < PB) {
					const error = new Error("zero index missing")
					throw error
				}

				await this._indexFd.read(buffer, 0, PB, indexOffset)
				if (Number(buffer.readBigInt64BE(0)) !== 0) {
					const error = new Error("index does not start at zero")
					throw error
				}

				indexOffset += PB

				while (indexOffset < this._indexLength) {
					await this._indexFd.read(buffer, 0, PB, indexOffset)
					const dataPointer = Number(buffer.readBigInt64BE(0))

					if (dataPointer < lastDataPointer) {
						const error = new Error("corrupted index")
						const key = indexOffset % PB
						error.key1 = key - 1
						error.value1 = lastDataPointer
						error.key2 = key
						error.value2 = dataPointer
						throw error
					}

					if (dataPointer > this._dataLength) {
						const error = new Error("missing data")
						error.key = indexOffset % PB
						error.value = dataPointer
						error.dataSize = this._dataLength
						throw error
					}

					indexOffset += PB
					lastDataPointer = dataPointer
				}

				if (indexOffset !== this._indexLength) {
					const error = new Error("odd bytes in index")
					error.indexSctualSize = this._indexLength
					error.indexExpectedSize = indexOffset

					indexOffset -= PB
					throw error
				}
			} catch (error) {
				error.code = Constants.ERROR.CORRUPTED
				if (!fix) {
					try {
						await this._lockFile.release()
					} catch (err) { }
					throw error
				}

				console.warn(error)

				await this._closeFds()
				await Promise.all([
					Fsp.truncate(this._locationData, lastDataPointer),
					Fsp.truncate(this._locationIndex, indexOffset),
				])
				await this._openFds()

				if (this._indexLength === 0) {
					buffer.fill(0)
					await this._indexFd.appendFile(buffer)
					await this._indexFd.datasync()
					this._indexLength += PB
				}
			}
		}

		this._state = Constants.STATE.OPEN
	}

	async close () {
		if (this._state !== Constants.STATE.OPEN) {
			const error = new Error("Cannot call close from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		this._state = Constants.STATE.CLOSING

		await this.flush()
		await Promise.all([
			this._closeFds(),
			this._lockFile.release(),
		])

		this._dataLength = null
		this._indexLength = null

		this._dataFd = null
		this._indexFd = null

		this._state = Constants.STATE.CLOSED
	}

	async _openFds () {
		await Promise.all([
			(async () => {
				this._dataFd = await Fsp.open(this._locationData, 'a')
				const stats = await this._dataFd.stat()
				this._dataLength = stats.size
			})(),
			(async () => {
				this._indexFd = await Fsp.open(this._locationIndex, 'a+')
				const stats = await this._indexFd.stat()
				this._indexLength = stats.size
			})(),
		])
	}

	async _closeFds () {
		await Promise.all([
			this._dataFd.close(),
			this._indexFd.close(),
		])
	}

	async append (dataBuffer) {
		if (this._state !== Constants.STATE.OPEN) {
			const error = new Error("Cannot call append from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		try {
			await this._sequence.push(async () => {
				this._dataLength += dataBuffer.length
				this._indexLength += PB
				const indexBuffer = Buffer.allocUnsafe(PB)
				indexBuffer.writeBigInt64BE(BigInt(this._dataLength))
				await Promise.all([
					this._dataFd.appendFile(dataBuffer).then(() => this._dataFd.datasync()),
					this._indexFd.appendFile(indexBuffer).then(() => this._indexFd.datasync()),
				])
			})
		} catch (error) {
			try { await this.close() } catch (_) {}
			throw error
		}
	}

	async flush (callback) {
		if (this._state !== Constants.STATE.OPEN && this._state !== Constants.STATE.CLOSING) {
			const error = new Error("Cannot call flush from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		await this._sequence.push(callback)
	}

	async get (index) {
		if (this._state !== Constants.STATE.OPEN) {
			const error = new Error("Cannot call get from this state")
			error.code = Constants.ERROR.BAD_STATE
			error.state = this._state
			throw error
		}

		const { length } = this
		if (index < 0 || index >= length) {
			const error = new Error("out of bounds")
			error.code = Constants.ERROR.OUT_OF_BOUNDS
			error.index = index
			error.min = 0
			error.max = length - 1
			throw error
		}

		try {
			const indexBuffer = Buffer.allocUnsafe(PB * 2)
			await this._indexFd.read(indexBuffer, 0, PB * 2, index * PB)
			const start = Number(indexBuffer.readBigInt64BE(0))
			const end = Number(indexBuffer.readBigInt64BE(PB)) - 1

			return Fs.createReadStream(this._locationData, { start, end })
		} catch (error) {
			try {
				await this._lockFile.release()
			} catch (err) {}
			throw error
		}
	}

	* keys (options = {}) {
		const {
			lt, lte, gt, gte,
			reverse, limit,
		} = options

		const [ beforeStart, _start, beforeEnd, _end ] = reverse
			? [ lt, lte, gte, gt ]
			: [ gt, gte, lte, lt ]
		const start
			= _start !== undefined ? _start
			: beforeStart !== undefined ? beforeStart + 1
			: 0
		const end
			= _end !== undefined ? _end
			: beforeEnd !== undefined ? beforeEnd + 1
			: limit !== undefined ? start + limit
			: this.length
		const inc = reverse ? -1 : 1

		for (let i = start; i < end; i += inc) {
			yield i
		}
	}

	async * entries (options = {}) {
		for await (const key of this.keys(options)) {
			yield [ key, await this.get(key) ]
		}
	}

	async * values (options = {}) {
		for await (const key of this.keys(options)) {
			yield await this.get(key)
		}
	}
}

module.exports = { LogDB }
