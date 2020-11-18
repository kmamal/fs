const Fs = require('fs')
const Fsp = Fs.promises
const Path = require('path')
const Os = require('os')

const TMP = Path.join(Os.tmpdir(), 'get-block-size-')

let cached = null

const getBlockSize = async () => {
	if (cached) { return cached }

	const temp_dir = await Fsp.mkdtemp(TMP)
	const file_path = Path.join(temp_dir, 'dummy')
	await Fsp.appendFile(file_path, 'a')

	const stats = await Fsp.stat(file_path)

	await Fsp.rm(temp_dir, { recursive: true })

	cached = stats.blksize
	return cached
}

const getBlockSizeSync = () => {
	if (cached) { return cached }

	const temp_dir = Fs.mkdtempSync(TMP)
	const file_path = Path.join(temp_dir, 'dummy')
	Fs.appendFileSync(file_path, 'a')

	const stats = Fs.statSync(file_path)

	Fs.rmSync(temp_dir, { recursive: true })

	cached = stats.blksize
	return cached
}

module.exports = {
	getBlockSize,
	getBlockSizeSync,
}
