const { test } = require('@kmamal/testing')
const { LogDB } = require('.')
const Fsp = require('fs').promises

const LOCATION = '/tmp/log-db'

const consume = async (stream) => {
	const chunks = []
	await new Promise((resolve, reject) => {
		stream
			.on('error', reject)
			.on('data', (chunk) => { chunks.push(chunk) })
			.on('end', resolve)
	})
	return Buffer.concat(chunks).toString()
}

test("LogDB", async (t) => {
	await Fsp.rm(LOCATION, { force: true, recursive: true })

	{
		const db = new LogDB(LOCATION)
		await db.open()
		await db.close()
	}

	{
		const db = new LogDB(LOCATION)
		await db.open()

		await db.append('foo')
		t.equal(await consume(await db.get(0)), 'foo')

		await db.append('bar')
		t.equal(await consume(await db.get(0)), 'foo')
		t.equal(await consume(await db.get(1)), 'bar')

		await db.append('baz')
		t.equal(await consume(await db.get(0)), 'foo')
		t.equal(await consume(await db.get(1)), 'bar')
		t.equal(await consume(await db.get(2)), 'baz')

		await db.close()
	}

	{
		const db = new LogDB(LOCATION)
		await db.open()

		t.equal(await consume(await db.get(0)), 'foo')
		t.equal(await consume(await db.get(1)), 'bar')
		t.equal(await consume(await db.get(2)), 'baz')

		t.equal(Array.from(db.keys()), [ 0, 1, 2 ])

		const values = [ 'foo', 'bar', 'baz' ]
		for await (const value of db.values()) {
			t.equal(await consume(value), values.shift())
		}
		t.equal(values, [])

		const entries = [ [ 0, 'foo' ], [ 1, 'bar' ], [ 2, 'baz' ] ]
		for await (const entry of db.entries()) {
			entry[1] = await consume(entry[1])
			t.equal(entry, entries.shift())
		}
		t.equal(entries, [])

		await db.close()
	}

	await Fsp.rm(LOCATION, { recursive: true })

	{
		const db = new LogDB(LOCATION)
		await db.open()

		db.append('foo')
		db.append('bar')
		db.append('baz')
		await db.flush()

		t.equal(await consume(await db.get(0)), 'foo')
		t.equal(await consume(await db.get(1)), 'bar')
		t.equal(await consume(await db.get(2)), 'baz')

		await db.close()
	}
})
