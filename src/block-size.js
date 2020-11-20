const Fs = require('fs')
const Fsp = Fs.promises
const Path = require('path')

const getBlockSize = async (path) => {
	const temp_dir = await Fsp.mkdtemp(path)
	try {
		const file_path = Path.join(temp_dir, 'dummy')
		await Fsp.appendFile(file_path, 'a')

		const stats = await Fsp.stat(file_path)
		return stats.blksize
	} finally {
		await Fsp.rm(temp_dir, { recursive: true })
	}
}

const getBlockSizeSync = (path) => {
	const temp_dir = Fs.mkdtempSync(path)
	try {
		const file_path = Path.join(temp_dir, 'dummy')
		Fs.appendFileSync(file_path, 'a')

		const stats = Fs.statSync(file_path)
		return stats.blksize
	} finally {
		Fs.rmSync(temp_dir, { recursive: true })
	}
}

module.exports = {
	getBlockSize,
	getBlockSizeSync,
}
