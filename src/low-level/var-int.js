
const BITS = 7
const BASE = 2 ** BITS

const BIG_BITS = BigInt(BITS)
const BIG_BASE = BigInt(BASE)
const BIG_MASK = BIG_BASE - 1n

const POWERS = []
for (let i = 0; i <= 7; i++) {
	POWERS[i] = BASE ** i
}

const big_powers = [ 1n ]
const getBigPower = (i) => {
	if (big_powers.length > i) { return big_powers[i] }
	const power = BIG_BASE * getBigPower(i - 1)
	big_powers[i] = power
	return power
}

const MAX_VALUE = POWERS[7] - 1

const countUInt = (value) => {
	for (let i = 1; i <= 7; i++) {
		if (value < POWERS[i]) { return i }
	}

	const error = new Error('invalid value')
	error.value = value
	error.min = 0
	error.max = MAX_VALUE
	throw error
}

const countBigUInt = (value) => {
	let i = 1
	for (;;) {
		if (value < getBigPower(i)) { return i }
		i++
	}
}

const readUIntVarLE = (buffer, _index) => {
	let index = _index
	let value = 0
	let count = 0
	let byte
	do {
		byte = buffer[index++]
		value += (byte & 0x7f) * POWERS[count++]
	} while ((byte & 0x80) && count < 7)
	return { value, count }
}

const readUIntVarBE = (buffer, _index) => {
	let index = _index
	let value = 0
	let count = 0
	let byte
	do {
		byte = buffer[index++]
		value = value * BASE + (byte & 0x7f)
		count++
	} while ((byte & 0x80) && count < 7)
	return { value, count }
}

const readBigUIntVarLE = (buffer, _index) => {
	let index = _index
	let value = BigInt(0)
	let count = 0
	let byte
	do {
		byte = buffer[index++]
		value += BigInt(byte & 0x7f) * getBigPower(count++)
	} while (byte & 0x80)
	return { value, count }
}

const readBigUIntVarBE = (buffer, _index) => {
	let index = _index
	let value = BigInt(0)
	let count = 0
	let byte
	do {
		count++
		byte = buffer[index++]
		value = value * BIG_BASE + BigInt(byte & 0x7f)
	} while (byte & 0x80)
	return { value, count }
}

const writeUIntVarLE = (buffer, _index, _value) => {
	if (_value < 0 || MAX_VALUE < _value) {
		const error = new Error('invalid value')
		error.value = _value
		error.min = 0
		error.max = MAX_VALUE
		throw error
	}

	let index = _index
	let value = _value
	let count = 0
	for (;;) {
		count++
		const byte = value % BASE
		value = Math.floor(value / BASE)
		if (value === 0) {
			buffer[index++] = byte
			break
		}
		buffer[index++] = byte | 0x80
	}
	return count
}

const writeUIntVarBE = (buffer, _index, _value) => {
	if (_value < 0 || MAX_VALUE < _value) {
		const error = new Error('invalid value')
		error.value = _value
		error.min = 0
		error.max = MAX_VALUE
		throw error
	}

	let index = _index
	let value = _value
	let i = 6

	while (i > 0 && value < POWERS[i]) {
		i--
	}

	const count = i + 1

	while (i) {
		const byte = Math.floor(value / POWERS[i])
		buffer[index++] = byte | 0x80
		value %= POWERS[i--]
	}

	buffer[index++] = value

	return count
}

const writeBigUIntVarLE = (buffer, _index, _value) => {
	if (_value < 0n) {
		const error = new Error('invalid value')
		error.value = _value
		error.min = 0n
		error.max = MAX_VALUE
		throw error
	}

	let index = _index
	let value = _value
	let count = 0
	for (;;) {
		count++
		const byte = Number(value & BIG_MASK)
		value >>= BIG_BITS
		if (value === 0n) {
			buffer[index++] = byte
			break
		}
		buffer[index++] = byte | 0x80
	}
	return count
}

const writeBigUIntVarBE = (buffer, _index, _value) => {
	if (_value < 0n) {
		const error = new Error('invalid value')
		error.value = _value
		error.min = 0n
		error.max = MAX_VALUE
		throw error
	}

	let index = _index
	let value = _value
	let i = 1

	while (value > getBigPower(i)) {
		i++
	}

	const count = i

	while (i > 1) {
		i--
		const power = getBigPower(i)
		const byte = value / power
		value %= power
		buffer[index++] = Number(byte) | 0x80
	}

	buffer[index++] = Number(value)

	return count
}

module.exports = {
	MAX_VALUE,
	countUInt,
	countBigUInt,
	readUIntVarBE,
	readUIntVarLE,
	readBigUIntVarBE,
	readBigUIntVarLE,
	writeUIntVarBE,
	writeUIntVarLE,
	writeBigUIntVarBE,
	writeBigUIntVarLE,
}
