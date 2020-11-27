
class Descending {
	constructor (buffer) {
		this._b = buffer
		this._end = buffer.length
		this._last1 = this._end - 1
		this._last2 = this._end - 2
		this._last4 = this._end - 4
		this._last8 = this._end - 8

		return new Proxy(this, {
			get: (obj, prop) => {
				const index = parseInt(prop, 10)
				if (Number.isNaN(index)) { return obj[prop] }
				return obj.get(index)
			},
			set: (obj, prop, value) => {
				const index = parseInt(prop, 10)
				if (Number.isNaN(index)) {
					obj[prop] = value
				} else {
					obj.set(index, value)
				}
				return true
			},
		})
	}

	get length () { return this._b.length }

	get (index) {
		return this._b[this._last1 - index]
	}

	set (index, value) {
		this._b[this._last1 - index] = value
	}

	slice (start, end) {
		// TODO: negatives and missing
		return this._b.slice(this._end - end, this._end - start)
	}

	readIntBE (i, s) { return this._b.readIntLE(this._end - s - i, s) }
	readIntLE (i, s) { return this._b.readIntBE(this._end - s - i, s) }
	readUIntBE (i, s) { return this._b.readUIntLE(this._end - s - i, s) }
	readUIntLE (i, s) { return this._b.readUIntBE(this._end - s - i, s) }

	readFloatBE (i = 0) { return this._b.readFloatLE(this._last4 - i) }
	readFloatLE (i = 0) { return this._b.readFloatBE(this._last4 - i) }
	readDoubleBE (i = 0) { return this._b.readDoubleLE(this._last8 - i) }
	readDoubleLE (i = 0) { return this._b.readDoubleBE(this._last8 - i) }

	readInt8 (i = 0) { return this._b.readInt8(this._last1 - i) }
	readUInt8 (i = 0) { return this._b.readUInt8(this._last1 - i) }

	readInt16BE (i = 0) { return this._b.readInt16LE(this._last2 - i) }
	readInt16LE (i = 0) { return this._b.readInt16BE(this._last2 - i) }
	readUInt16BE (i = 0) { return this._b.readUInt16LE(this._last2 - i) }
	readUInt16LE (i = 0) { return this._b.readUInt16BE(this._last2 - i) }

	readInt32BE (i = 0) { return this._b.readInt32LE(this._last4 - i) }
	readInt32LE (i = 0) { return this._b.readInt32BE(this._last4 - i) }
	readUInt32BE (i = 0) { return this._b.readUInt32LE(this._last4 - i) }
	readUInt32LE (i = 0) { return this._b.readUInt32BE(this._last4 - i) }

	readBigInt64BE (i = 0) { return this._b.readBigInt64LE(this._last8 - i) }
	readBigInt64LE (i = 0) { return this._b.readBigInt64BE(this._last8 - i) }
	readBigUInt64BE (i = 0) { return this._b.readBigUInt64LE(this._last8 - i) }
	readBigUInt64LE (i = 0) { return this._b.readBigUInt64BE(this._last8 - i) }

	writeIntBE (x, i, s) { return this._b.writeIntLE(x, this._end - s - i, s) }
	writeIntLE (x, i, s) { return this._b.writeIntBE(x, this._end - s - i, s) }
	writeUIntBE (x, i, s) { return this._b.writeUIntLE(x, this._end - s - i, s) }
	writeUIntLE (x, i, s) { return this._b.writeUIntBE(x, this._end - s - i, s) }

	writeFloatBE (x, i = 0) { return this._b.writeFloatLE(x, this._last4 - i) }
	writeFloatLE (x, i = 0) { return this._b.writeFloatBE(x, this._last4 - i) }
	writeDoubleBE (x, i = 0) { return this._b.writeDoubleLE(x, this._last8 - i) }
	writeDoubleLE (x, i = 0) { return this._b.writeDoubleBE(x, this._last8 - i) }

	writeInt8 (x, i = 0) { return this._b.writeInt8(x, this._last1 - i) }
	writeUInt8 (x, i = 0) { return this._b.writeUInt8(x, this._last1 - i) }

	writeInt16BE (x, i = 0) { return this._b.writeInt16LE(x, this._last2 - i) }
	writeInt16LE (x, i = 0) { return this._b.writeInt16BE(x, this._last2 - i) }
	writeUInt16BE (x, i = 0) { return this._b.writeUInt16LE(x, this._last2 - i) }
	writeUInt16LE (x, i = 0) { return this._b.writeUInt16BE(x, this._last2 - i) }

	writeInt32BE (x, i = 0) { return this._b.writeInt32LE(x, this._last4 - i) }
	writeInt32LE (x, i = 0) { return this._b.writeInt32BE(x, this._last4 - i) }
	writeUInt32BE (x, i = 0) { return this._b.writeUInt32LE(x, this._last4 - i) }
	writeUInt32LE (x, i = 0) { return this._b.writeUInt32BE(x, this._last4 - i) }

	writeBigInt64BE (x, i = 0) { return this._b.writeBigInt64LE(x, this._last8 - i) }
	writeBigInt64LE (x, i = 0) { return this._b.writeBigInt64BE(x, this._last8 - i) }
	writeBigUInt64BE (x, i = 0) { return this._b.writeBigUInt64LE(x, this._last8 - i) }
	writeBigUInt64LE (x, i = 0) { return this._b.writeBigUInt64BE(x, this._last8 - i) }

	// copy
}

module.exports = { Descending }
