
class Sequential {
	constructor () {
		this._queue = []
		this._processing = null
	}

	async push (callback) {
		await new Promise((resolve, reject) => {
			this._queue.push({ callback, resolve, reject })
			this._process()
		})
	}

	async _process () {
		if (this._processing) { return }
		let done
		this._processing = new Promise((_resolve) => { done = _resolve })

		const queue = this._queue
		while (queue.length > 0) {
			const { callback, resolve, reject } = queue.shift()
			let error
			let value
			if (callback) {
				try {
					value = await callback()
				} catch (_error) { error = _error }
			}
			error ? reject(error) : resolve(value)
		}

		this._processing = null
		done()
	}
}

module.exports = { Sequential }
