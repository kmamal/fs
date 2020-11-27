
const MASKS = []
for (let i = 0; i <= 8; i++) {
	MASKS[i] = 2 ** i - 1
}

const bishift = (x, n) => n < 0 ? x >>> -n : x << n

const makeDescription = (fields) => {
	const parts = []

	let index = 0
	let available = 8
	let last_in_byte = false
	for (const field of fields) {
		const { name, bits } = field

		if (!Number.isInteger(bits) || bits < 1) {
			const error = new Error('bad bits')
			error.field = field
			throw error
		}

		const part = { name, index, steps: [] }

		let remaining = bits
		while (remaining > 0) {
			if (last_in_byte) {
				available = 8
				index += 1
			}

			const n = Math.min(available, remaining)
			remaining -= n
			available -= n
			last_in_byte = available === 0

			const shift_in_byte = available
			const shift_in_value = remaining
			const byte_mask = MASKS[n] << shift_in_byte
			const value_mask = MASKS[n] << shift_in_value
			const shift = shift_in_value - shift_in_byte
			part.steps.push({ byte_mask, value_mask, shift, last_in_byte })
		}

		parts.push(part)
	}

	return { byteLength: index, parts }
}

const defineRecord = (fields) => {
	const description = {}

	for (const part of fields.parts) {
		const { name, index: _index, steps } = part
		description[name] = {
			enumerable: true,
			get () {
				const { _buffer: b, _index: i } = this
				let value = 0
				let index = i + _index
				let byte = b[index]
				for (const step of steps) {
					const { byte_mask, shift, last_in_byte } = step
					value |= bishift(byte & byte_mask, shift)
					if (last_in_byte) { byte = b[++index] }
				}
				return value
			},
			set (value) {
				const { _buffer: b, _index: i } = this
				let index = i + _index
				for (const step of steps) {
					const { byte_mask, value_mask, shift, last_in_byte } = step
					const byte = bishift(value & value_mask, -shift)
					b[index] &= ~byte_mask
					b[index] |= byte
					if (last_in_byte) { index++ }
				}
			},
		}
	}

	return class {
		constructor (buffer, index = 0) {
			this._buffer = buffer
			this._index = index
			Object.defineProperties(this, description)
		}
	}
}

const defineReader = (fields) => (out_value, buffer, _index) => {
	let index = _index
	let byte = buffer[index]
	for (const part of fields.parts) {
		const { name, steps } = part
		let value = 0

		for (const step of steps) {
			const { byte_mask, shift, last_in_byte } = step
			value |= bishift(byte & byte_mask, shift)
			if (last_in_byte) { byte = buffer[++index] }
		}

		out_value[name] = value
	}

	return fields.byteLength
}

const defineWriter = (fields) => (in_value, buffer, _index) => {
	let index = _index
	buffer[index] = 0
	for (const part of fields.parts) {
		const { name, steps } = part

		const value = in_value[name]
		for (const step of steps) {
			const { value_mask, shift, last_in_byte } = step
			buffer[index] |= bishift(value & value_mask, -shift)
			if (last_in_byte) { buffer[++index] = 0 }
		}
	}

	return fields.byteLength
}

module.exports = {
	makeDescription,
	defineRecord,
	defineReader,
	defineWriter,
}
