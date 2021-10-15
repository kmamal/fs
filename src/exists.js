const Fs = require('fs')

const exists = (path) => new Promise((resolve) => {
	Fs.access(path, (error) => { resolve(!error) })
})

const existsSync = (path) => {
	try {
		Fs.accessSync(path)
		return true
	} catch (error) {
		if (error.code !== 'ENOENT') { throw error }
		return false
	}
}

module.exports = {
	exists,
	existsSync,
}
