const Fs = require('fs')
const Fsp = Fs.promises

const touch = async (path) => {
	const time = Math.floor(Date.now() / 1e3)
	try {
		await Fsp.utimesSync(path, time, time)
	} catch (error) {
		if (error.code !== 'ENOENT') { throw error }
		(await Fsp.open(path, 'w')).close()
	}
}

const touchSync = (path) => {
	const time = Math.floor(Date.now() / 1e3)
	try {
		Fs.utimesSync(path, time, time)
	} catch (error) {
		if (error.code !== 'ENOENT') { throw error }
		Fs.closeSync(Fs.openSync(path, 'w'))
	}
}

module.exports = {
	touch,
	touchSync,
}
