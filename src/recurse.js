const Fsp = require('fs').promises
const Path = require('path')
const { promise: { Semaphore } } = require('@kmamal/util')

const _recurse = async ({ path, name }, visitors, semaphore) => {
	const { onFile, onDir, filter } = visitors

	const stats = await Fsp.stat(path)

	if (filter) {
		await semaphore.free()
		const result = await filter({ path, name, stats })
		if (!result) { return null }
	}

	if (stats.isDirectory()) {
		const dir = await Fsp.opendir(path)

		const promises = []
		for await (const direntry of dir) {
			const { name: child_name } = direntry
			const child_path = Path.join(path, child_name)
			const entry = {
				name: child_name,
				path: child_path,
			}

			await semaphore.free()
			const promise = _recurse(entry, visitors, semaphore)
			promises.push(promise)
		}
		const contents = await Promise.all(promises)

		if (onDir) {
			await semaphore.dec()
			const result = await onDir({ path, name, stats, contents })
			semaphore.inc()
			return result
		}

		if (onFile) {
			return contents
		}

		return null
	}

	if (onFile) {
		await semaphore.dec()
		const result = await onFile({ path, name, stats })
		semaphore.inc()
		return result
	}

	return null
}

const recurse = (_path, options) => {
	const {
		onFile, onDir, filter,
		concurrency, semaphore: _semaphore,
	} = options

	const path = Path.resolve(_path)
	const name = Path.basename(path)
	const visitors = { onFile, onDir, filter }
	const semaphore = _semaphore || new Semaphore(concurrency)

	return _recurse({ name, path }, visitors, semaphore)
}

module.exports = { recurse }
