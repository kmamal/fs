const { getType } = require('./types')

const _makeConstructor = (description) => {
	const { type } = description
	if (type === 'struct') { return makeObjectConstructor(description) }
	if (type === 'array') { return makeArrayConstructor(description) }
	return null
}

const makeArrayConstructor = (description) => {
	const { count: item_count, item } = description

	if (!item_count) {
		const error = new Error('missing count')
		error.description = description
		throw error
	}

	if (!item) {
		const error = new Error('missing item description')
		error.description = description
		throw error
	}

	const ItemClass = _makeConstructor(item)
	if (ItemClass) {
		return class {
			static SIZE = item_count * ItemClass.SIZE

			constructor (buffer, index) {
				this._buffer = buffer
				this._index = index

				let offset = 0
				for (let i = 0; i < item_count; i++) {
					this[i] = new ItemClass(this._buffer, offset)
					offset += ItemClass.SIZE
				}
			}

			setBuffer (buffer) {
				this._buffer = buffer
				for (let i = 0; i < item_count; i++) {
					this[i].setBuffer(buffer)
				}
			}

			setIndex (index) {
				this._index = index
				let offset = 0
				for (let i = 0; i < item_count; i++) {
					this[i].setIndex(index + offset)
					offset += ItemClass.SIZE
				}
			}
		}
	}

	const { type } = item
	const type_def = getType(type, true)
	const size = type_def.size || item.size
	if (!size) {
		const error = new Error('missing size')
		error.description = item
		throw error
	}

	const properties = {}
	let offset = 0
	for (let i = 0; i < item_count; i++) {
		const _offset = offset
		offset += size

		properties[i] = {
			enumerable: true,
			get () {
				return type_def.read(this._buffer, this._index + _offset, size)
			},
			set (value) {
				type_def.write(this._buffer, this._index + _offset, value, size)
			},
		}
	}

	return class {
		static SIZE = offset

		constructor (buffer, index) {
			this._buffer = buffer
			this._index = index
			Object.makeProperties(this, properties)
		}

		setBuffer (buffer) { this._buffer = buffer }
		setIndex (index) { this._index = index }
	}
}

const makeObjectConstructor = (description) => {
	const properties = {}
	const nested = []

	let offset = 0
	for (const field of description.fields) {
		const { name } = field

		const NestedClass = _makeConstructor(field)
		if (NestedClass) {
			nested.push({ name, NestedClass, offset })
			offset += NestedClass.SIZE
			continue
		}

		const type_def = getType(field, true)

		const size = type_def.size || field.size
		if (!size) {
			const error = new Error('missing size')
			error.field = field
			throw error
		}

		const _offset = offset
		offset += size

		properties[name] = {
			enumerable: true,
			get () {
				return type_def.read(this._buffer, this._index + _offset, size)
			},
			set (value) {
				type_def.write(this._buffer, this._index + _offset, value, size)
			},
		}
	}

	return class {
		static SIZE = offset

		constructor (buffer, index = 0) {
			this._buffer = buffer
			this._index = index
			for (const { name, NestedClass, offset: nested_offset } of nested) {
				this[name] = new NestedClass(buffer, nested_offset)
			}
			Object.makeProperties(this, properties)
		}

		setBuffer (buffer) {
			this._buffer = buffer
			for (const { name } of nested) {
				this[name].setBuffer(buffer)
			}
		}

		setIndex (index) {
			this._index = index
			for (const { name, offset: nested_offset } of nested) {
				this[name].setIndex(index + nested_offset)
			}
		}
	}
}

const makeConstructor = (description) => {
	const Class = _makeConstructor(description)
	if (Class) { return Class }

	const error = new Error('bad description')
	error.description = description
	throw error
}

module.exports = { makeConstructor }


makeConstructor({
	type: 'struct',
	fields: [
		{ name: 'size', type: 'uint_be', size: leaf_size_bytes },
		{
			name: 'links',
			type: 'struct',
			fields: [
				{ name: 'next', type: 'uint_be', size: pointer_bytes },
				{ name: 'prev', type: 'uint_be', size: pointer_bytes },
			],
		},
		{
			name: 'keys',
			type: 'array',
			count: order,
			item: { type: 'uint_be', size: value_bytes },
		},
		{
			name: 'values',
			type: 'array',
			size: order,
			item: { type: 'uint_be', size: value_bytes },
		},
	],
})
