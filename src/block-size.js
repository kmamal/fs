const Fs = require('fs')
const Fsp = Fs.promises
const Path = require('path')

const getBlockSize = async (path) => {
	const tempDir = await Fsp.mkdtemp(path)
	try {
		const filePath = Path.join(tempDir, 'dummy')
		await Fsp.appendFile(filePath, 'a')

		const stats = await Fsp.stat(filePath)
		return stats.blksize
	} finally {
		await Fsp.rm(tempDir, { recursive: true })
	}
}

const getBlockSizeSync = (path) => {
	const tempDir = Fs.mkdtempSync(path)
	try {
		const filePath = Path.join(tempDir, 'dummy')
		Fs.appendFileSync(filePath, 'a')

		const stats = Fs.statSync(filePath)
		return stats.blksize
	} finally {
		Fs.rmSync(tempDir, { recursive: true })
	}
}

module.exports = {
	getBlockSize,
	getBlockSizeSync,
}
