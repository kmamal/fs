
const makeReader = (description) => {
	const steps = description.map((field) => {
		const { name, type } = field

		const type_def = getType(field)

		let size
		if (!type.var) {
			size = type_def.size || field.size
			if (!size) {
				const error = new Error('missing size')
				error.field = field
				throw error
			}
		}

		return (dst, buffer, index) => {
			let result = type_def.read(buffer, index, size)
			if (type.var) {
				size = result.count
				result = result.value
			}
			dst[name] = result
			return size
		}
	})

	return (dst, buffer, index = 0) => {
		let offset = index
		for (const step of steps) {
			offset += step(dst, buffer, offset)
		}
		return offset - index
	}
}
