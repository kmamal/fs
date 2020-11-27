const V = require('../var-int')

const fixed_length_type_defs = {
	int8: { size: 1, read: (b, i) => b.readInt8(i), write: (b, i, v) => { b.writeInt8(v, i) } },
	uint8: { size: 1, read: (b, i) => b.readUInt8(i), write: (b, i, v) => { b.writeUInt8(v, i) } },
	int: { alias: 'int_be' },
	int_be: { read: (b, i, s) => b.readIntBE(i, s), write: (b, i, v, s) => { b.writeIntBE(v, i, s) } },
	int_le: { read: (b, i, s) => b.readIntLE(i, s), write: (b, i, v, s) => { b.writeIntLE(v, i, s) } },
	uint: { alias: 'uint_be' },
	uint_be: { read: (b, i, s) => b.readUIntBE(i, s), write: (b, i, v, s) => { b.writeUIntBE(v, i, s) } },
	uint_le: { read: (b, i, s) => b.readUIntLE(i, s), write: (b, i, v, s) => { b.writeUIntLE(v, i, s) } },
	int16: { alias: 'int16_be' },
	int16_be: { size: 2, read: (b, i) => b.readInt16BE(i), write: (b, i, v) => { b.writeInt16BE(v, i) } },
	int16_le: { size: 2, read: (b, i) => b.readInt16LE(i), write: (b, i, v) => { b.writeInt16LE(v, i) } },
	uint16: { alias: 'uint16_be' },
	uint16_be: { size: 2, read: (b, i) => b.readUInt16BE(i), write: (b, i, v) => { b.writeUInt16BE(v, i) } },
	uint16_le: { size: 2, read: (b, i) => b.readUInt16LE(i), write: (b, i, v) => { b.writeUInt16LE(v, i) } },
	int32: { alias: 'int32_be' },
	int32_be: { size: 4, read: (b, i) => b.readInt32BE(i), write: (b, i, v) => { b.writeInt32BE(v, i) } },
	int32_le: { size: 4, read: (b, i) => b.readInt32LE(i), write: (b, i, v) => { b.writeInt32LE(v, i) } },
	uint32: { alias: 'uint32_be' },
	uint32_be: { size: 4, read: (b, i) => b.readUInt32BE(i), write: (b, i, v) => { b.writeUInt32BE(v, i) } },
	uint32_le: { size: 4, read: (b, i) => b.readUInt32LE(i), write: (b, i, v) => { b.writeUInt32LE(v, i) } },
	int64: { alias: 'int64_be' },
	int64_be: { size: 8, read: (b, i) => b.readBigInt64BE(i), write: (b, i, v) => { b.writeBigInt64BE(v, i) } },
	int64_le: { size: 8, read: (b, i) => b.readBigInt64LE(i), write: (b, i, v) => { b.writeBigInt64LE(v, i) } },
	uint64: { alias: 'uint64_be' },
	uint64_be: { size: 8, read: (b, i) => b.readBigUInt64BE(i), write: (b, i, v) => { b.writeBigUInt64BE(v, i) } },
	uint64_le: { size: 8, read: (b, i) => b.readBigUInt64LE(i), write: (b, i, v) => { b.writeBigUInt64LE(v, i) } },
}

const variable_length_type_defs = {
	var_uint: { alias: 'var_uint_be' },
	var_uint_be: { var: true, read: (b, i) => V.readUIntVarBE(b, i), write: (b, i, v) => V.writeUIntVarBE(b, i, v) },
	var_uint_le: { var: true, read: (b, i) => V.readUIntVaLE(b, i), write: (b, i, v) => V.writeUIntVaLE(b, i, v) },
	var_biguint: { alias: 'var_biguint_be' },
	var_biguint_be: { var: true, read: (b, i) => V.readBigUIntVarBE(b, i), write: (b, i, v) => V.writeBigUIntVarBE(b, i, v) },
	var_biguint_le: { var: true, read: (b, i) => V.readBigUIntVaLE(b, i), write: (b, i, v) => V.writeBigUIntVaLE(b, i, v) },
}

const type_defs = {
	...fixed_length_type_defs,
	...variable_length_type_defs,
}

const fixed_length_type_names = Object.keys(fixed_length_type_defs)
const variable_length_type_names = Object.keys(variable_length_type_defs)
const type_names = [
	...fixed_length_type_names,
	...variable_length_type_names,
]

const getType = (description, fixed_only = false) => {
	const { type } = description

	if (!type_names.includes(description.type)) {
		const error = new Error('unknown type')
		error.description = description
		throw error
	}

	if (fixed_only && variable_length_type_names.includes(type)) {
		const error = new Error('variable length field')
		error.description = description
		throw error
	}

	let type_def = type_defs[type]
	while (type_def.alias) { type_def = type_defs[type_def.alias] }

	return type_def
}

module.exports = { getType }
