const Fs = require('fs')
const Fsp = Fs.promises
const Constants = require('./constants')

class LockFile {
	constructor (location) {
		this._location = location
	}

	async acquire () {
		try {
			await Fsp.appendFile(this._location, Constants.PID, { flag: 'ax' })
		} catch (_error) {
			let contents
			try {
				contents = await Fsp.readFile(this._location)
			} catch (_) { }

			const reason
				= (_error.code === 'EEXIST') && "exists"
				|| (_error.code === 'EACCES') && "inaccessible"
				|| null

			if (reason) {
				const error = new Error(`lock file ${reason}`)
				error.code = Constants.ERROR.LOCKED
				error.contents = contents
				throw error
			}

			throw _error
		}
	}

	async release () {
		await Fsp.unlink(this._location)
	}
}

module.exports = { LockFile }
