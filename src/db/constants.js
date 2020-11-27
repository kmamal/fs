
const STATE = {
	CLOSED: 'closed',
	OPENING: 'opening',
	OPEN: 'open',
	CLOSING: 'closing',
}

const ERROR = {
	BAD_STATE: 'bad-state',
	MISSING: 'missing',
	LOCKED: 'locked',
	CORRUPTED: 'corrupted',
	OUT_OF_BOUNDS: 'out-of-bounds',
}

const POINTER_BYTES = 8

const PID = Buffer.from(`${process.pid}`)

module.exports = {
	STATE,
	ERROR,
	POINTER_BYTES,
	PID,
}
