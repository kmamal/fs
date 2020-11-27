const { test } = require('@xyz/testing')
const { Descending } = require('./descending')

const equalReversed = (t, a, b) => {
	const { length: a_length } = a
	const { length: b_length } = b
	t.equal(a_length, b_length)
	for (let i = 0; i < a_length; i++) {
		t.equal(a[i], b[b_length - i - 1])
	}
}

test('low-level.descending', (t) => {
	const a = Buffer.alloc(16)
	const b = Buffer.alloc(16)
	const c = new Descending(b)
	equalReversed(t, a, b)

	a[0] = 1
	c[0] = 1
	equalReversed(t, a, b)

	a[15] = 2
	c[15] = 2
	equalReversed(t, a, b)

	a.writeBigUInt64BE(2n ** 64n - 1n, 2)
	c.writeBigUInt64BE(2n ** 64n - 1n, 2)
	equalReversed(t, a, b)

	t.equal(a.readBigUInt64LE(0), c.readBigUInt64LE(0))
	t.equal(a.readBigUInt64LE(8), c.readBigUInt64LE(8))
})
