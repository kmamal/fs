const { test } = require('@xyz/testing')
const { countUInt } = require('./var-int')
const V = require('./var-int')

const randInt = () => {
	const base = Math.random()
	const exp = Math.floor(Math.random() * 47 + 1)
	return Math.floor(base * 2 ** exp)
}

const N = 100

const makeTest = (name, read, write, count, random, max_size) => {
	test(`low-level.var-int.${name}`, (t) => {
		const buffer = Buffer.alloc(max_size * N)
		const values = []
		let offset

		offset = 0
		for (let i = 0; i < N; i++) {
			const value = random()
			values.push(value)
			const count_expected = count(value)
			const count_actual = write(buffer, offset, value)
			t.equal(count_actual, count_expected, { value })
			offset += count_actual
		}

		offset = 0
		for (let i = 0; i < N; i++) {
			const { value, count: step } = read(buffer, offset)
			t.equal(value, values[i], { values, i, buffer })
			offset += step
		}
	})
}

makeTest('uint-be', V.readUIntVarBE, V.writeUIntVarBE, V.countUInt, randInt, 6)
makeTest('uint-le', V.readUIntVarLE, V.writeUIntVarLE, V.countUInt, randInt, 6)
makeTest('big-uint-be', V.readBigUIntVarBE, V.writeBigUIntVarBE, V.countBigUInt, () => BigInt(randInt()), 6)
makeTest('big-uint-le', V.readBigUIntVarLE, V.writeBigUIntVarLE, V.countBigUInt, () => BigInt(randInt()), 6)
