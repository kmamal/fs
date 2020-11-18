const Fsp = require('fs').promises
const Path = require('path')
const Os = require('os')

const TMP = Path.join(Os.tmpdir(), 'get-block-size-')

const getBlockSize = async () => {
	const temp_dir = await Fsp.mkdtemp(TMP)
	const file_path = Path.join(temp_dir, 'dummy')
	await Fsp.appendFile(file_path, 'a')

	const stats = await Fsp.stat(file_path)

	await Fsp.rm(temp_dir, { recursive: true })

	return stats.blksize
}

module.exports = { getBlockSize }
