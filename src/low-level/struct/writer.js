
const makeWriter = (description) => {
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

		return (src, buffer, index) => {
			const result = type_def.write(buffer, index, src[name], size)
			if (type.var) { size = result }
			return size
		}
	})

	return (src, buffer, index = 0) => {
		let offset = index
		for (const step of steps) {
			offset += step(src, buffer, offset)
		}
		return offset - index
	}
}
