const { Descending } = require('./descending')

class FreeList {
	constructor (header, data, descending = false) {
		this._header = header
		this._data = descending ? new Descending(data) : data

		this._pb = header.length
		this._hb = 2 * this._pb
	}

	reset () {
		this._writeFirst(0)
		this._writeSize(0, this._capacity)
		this._writeNext(0, -1)
	}

	alloc (_n) {
		const n = _n + this._hb

		let prev = -1
		let curr = this._readFirst()
		while (curr !== -1) {
			const size = this._readSize(curr)

			if (size >= n) {
				const pointer = curr

				const start = curr

				let next = this._readNext(curr)

				if (n < size) {
					curr = start + n
					this._writeSize(curr, size - n)
					this._writeNext(curr, next)
					next = curr
				}

				if (prev === -1) {
					this._writeFirst(next)
				} else {
					this._writeNext(prev, next)
				}

				this._writeSize(start, n)
				const buffer = this._slice(start, n)
				return { pointer, buffer }
			}

			prev = curr
			curr = this._readNext(curr)
		}

		throw new Error('out of memory')
	}

	free (addr) {
		let curr = this._readFirst()

		if (curr === -1) {
			this._writeFirst(addr)
			this._writeNext(addr, -1)
			return
		}

		if (curr > addr) {
			this._writeFirst(addr)
			const addr_size = this._readSize(addr)

			const touches_curr = addr + addr_size === curr
			if (touches_curr) {
				const curr_size = this._readSize(curr)
				const curr_next = this._readNext(curr)
				const total_size = addr_size + curr_size
				this._writeSize(addr, total_size)
				this._writeNext(addr, curr_next)
			} else {
				this._writeNext(addr, curr)
			}
			return
		}

		let prev = curr
		curr = this._readNext(curr)

		while (curr !== -1) {
			if (curr > addr) {
				const prev_size = this._readSize(prev)
				const addr_size = this._readSize(addr)

				const touches_prev = prev + prev_size === addr
				const touches_curr = addr + addr_size === curr

				if (touches_prev && touches_curr) {
					const curr_size = this._readSize(curr)
					const curr_next = this._readNext(curr)
					const total_size = prev_size + addr_size + curr_size
					this._writeSize(prev, total_size)
					this._writeNext(prev, curr_next)
				} else if (touches_prev) {
					const total_size = prev_size + addr_size
					this._writeSize(prev, total_size)
				} else if (touches_curr) {
					this._writeNext(prev, addr)
					const curr_size = this._readSize(curr)
					const curr_next = this._readNext(curr)
					const total_size = addr_size + curr_size
					this._writeSize(addr, total_size)
					this._writeNext(addr, curr_next)
				} else {
					this._writeNext(prev, addr)
					this._writeNext(addr, curr)
				}

				return
			}

			prev = curr
			curr = this._readNext(curr)
		}

		{
			const prev_size = this._readSize(prev)
			const touches_prev = prev + prev_size === addr
			if (touches_prev) {
				const addr_size = this._readSize(addr)
				const total_size = prev_size + addr_size
				this._writeSize(prev, total_size)
			} else {
				this._writeNext(prev, addr)
			}
		}
	}

	_slice (start, size) { return this._data.slice(start, start + size) }

	_readFirst () { return this._header.readUIntBE(0, this._pb) - 1 }
	_writeFirst (next) { this._header.writeUIntBE(next + 1, 0, this._pb) }

	_readSize (addr) { return this._data.readUIntBE(addr, this._pb) }
	_writeSize (addr, size) { this._data.writeUIntBE(size, addr, this._pb) }

	_readNext (addr) { return this._data.readUIntBE(addr + this._pb, this._pb) - 1 }
	_writeNext (addr, next) { this._data.writeUIntBE(next + 1, addr + this._pb, this._pb) }
}

module.exports = { FreeList }
