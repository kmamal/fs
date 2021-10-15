const Fs = require('fs')
const Fsp = Fs.promises
const Path = require('path')
const { exists: doesExist } = require('../../exists')
const { getBlockSize } = require('../../block-size')
const { __bisect } = require('@kmamal/util/array/bisect')
const { Lru } = require('@kmamal/util/structs/caches/lru')
const { LockFile } = require('../lock-file')
const Constants = require('../constants')

const PB = Constants.POINTER_BYTES

const readPointer = (b) => Number(b.readBigUInt64BE(0))
const writePointer = (b, x) => b.writeBigUInt64BE(BigInt(x), 0)

const LOCK_FILE_NAME = 'lock'
const META_FILE_NAME = 'meta'

class IndexDB {
	constructor (location) {
		this._location = location
		this._lock_file = new LockFile(Path.join(location, LOCK_FILE_NAME))
		this._location_meta = Path.join(location, META_FILE_NAME)

		this._state = Constants.STATE.CLOSED

		this._fn = null
		this._meta = null
		this._node_bytes = null
		this._leaf_bytes = null
		this._readNodeSize = null
		this._writeNodeSize = null
		this._readLeafSize = null
		this._writeLeafSize = null
		// this._node_pool = null
		// this._leaf_pool = null
		this._node_lru = null
		this._leaf_lru = null
	}

	get location () { return this._location }

	get state () { return this._state }

	get length () { return this._meta.size }
	get node_order () { return this._meta.node_order }
	get leaf_order () { return this._meta.leaf_order }
	get node_size_bytes () { return this._meta.node_size_bytes }
	get leaf_size_bytes () { return this._meta.leaf_size_bytes }
	get key_bytes () { return this._meta.key_bytes }
	get value_bytes () { return this._meta.value_bytes }
	get depth () { return this._meta.depth }

	async open (options = {}) {
		const {
			truncate = false,
			create = true,
			validate = true,
			fn,
		} = options

		if (this._state !== Constants.STATE.CLOSED) {
			const error = new Error("Cannot call open from this state")
			error.code = Constants.BAD_STATE
			error.state = this._state
			throw error
		}

		await Fsp.mkdir(this._location, { recursive: true })
		this._lock_file.acquire()

		this._state = Constants.STATE.OPENING

		if (typeof fn !== 'function') {
			const error = new Error("fn must be a function")
			error.value = fn
			throw error
		}

		// TODO: race condition
		let exists = await doesExist(this._location_meta)

		if (!exists && !create) {
			const error = new Error("not found")
			error.code = Constants.MISSING
			error.path = this._location
			throw error
		}

		try {
			if (exists && truncate) {
				const dir = await Fsp.opendir(this._location)
				for await (const { name } of dir) {
					if (name === LOCK_FILE_NAME) { continue }
					await Fsp.unlink(Path.join(this._location, name))
				}

				exists = false
			}

			if (!exists) {
				const { key_bytes, value_bytes } = options

				if (key_bytes === undefined) { throw new Error("key_bytes is undefined") }
				if (value_bytes === undefined) { throw new Error("value_bytes is undefined") }

				const block_size = await getBlockSize(this._location)
				let num_blocks = 0

				let node_order
				let node_size_bytes = 1

				for (;;) {
					num_blocks += 1

					const overhead = node_size_bytes - key_bytes
					const available_size = block_size * num_blocks
					const free_size = available_size - overhead
					const item_size = key_bytes + PB
					node_order = Math.floor(free_size /	item_size)

					const new_node_size_bytes = Math.ceil(Math.log2(node_order) / 8)
					if (new_node_size_bytes > node_size_bytes) {
						node_size_bytes += 1
						num_blocks -= 1
						continue
					}

					if (node_order > 4) { break }
				}

				let leaf_order = node_order
				let leaf_size_bytes = node_size_bytes

				for (;;) {
					const overhead = leaf_size_bytes + 2 * PB
					const item_size = key_bytes + value_bytes
					const required_size = overhead + leaf_order * item_size
					const available_size = block_size * Math.ceil(required_size / block_size)
					const extra_size = available_size - required_size
					const extra_items = Math.floor(extra_size /	item_size)
					const new_leaf_order = leaf_order + extra_items

					const new_leaf_size_bytes = Math.ceil(Math.log2(new_leaf_order) / 8)
					if (new_leaf_size_bytes === leaf_size_bytes) {
						leaf_order = new_leaf_order
						break
					}
					leaf_size_bytes += 1
				}

				this._node_bytes = node_size_bytes + (node_order - 1) * key_bytes + node_order * PB
				this._leaf_bytes = leaf_size_bytes + 2 * PB + leaf_order * (key_bytes + value_bytes)
				this._readNodeSize = (b) => b.readUIntBE(0, node_size_bytes)
				this._writeNodeSize = (b, x) => { b.writeUIntBE(x, 0, node_size_bytes) }
				this._readLeafSize = (b) => b.readUIntBE(0, leaf_size_bytes)
				this._writeLeafSize = (b, x) => { b.writeUIntBE(x, 0, leaf_size_bytes) }

				this._meta = {
					size: 0,
					depth: 0,
					node_order,
					leaf_order,
					block_size,
					node_size_bytes,
					leaf_size_bytes,
					key_bytes,
					value_bytes,
					root: null,
					first: null,
					last: null,
					next_id: 1,
				}

				const root = this._makeNewLeaf()
				this._meta.root = root.id
				this._meta.first = root.id
				this._meta.last = root.id

				await this._writeLeaf(root)
				await this._writeMeta()
			} else {
				try {
					const json = (await Fsp.readFile(this._location_meta)).toString()
					try {
						this._meta = JSON.parse(json)
					} catch (err) {
						const error = new Error("corrupted meta")
						throw error
					}

					const {
						size, depth, node_order, leaf_order,
						block_size, node_size_bytes, leaf_size_bytes, key_bytes, value_bytes,
						root, first, last, next_id,
					} = this._meta

					if (validate) {
						if (!Number.isInteger(size) || size < 0) {
							const error = new Error("bad size")
							error.value = size
							throw error
						}

						if (!Number.isInteger(depth) || depth < 0) {
							const error = new Error("bad depth")
							error.value = depth
							throw error
						}

						if (!Number.isInteger(node_order) || node_order < 4) {
							const error = new Error("bad node_order")
							error.value = node_order
							throw error
						}

						if (!Number.isInteger(leaf_order) || leaf_order < 4) {
							const error = new Error("bad leaf_order")
							error.value = leaf_order
							throw error
						}

						if (!Number.isInteger(block_size) || block_size < 1) {
							const error = new Error("bad block_size")
							error.value = block_size
							throw error
						}

						if (!Number.isInteger(node_size_bytes) || node_size_bytes < 1) {
							const error = new Error("bad node_size_bytes")
							error.value = node_size_bytes
							throw error
						}

						if (!Number.isInteger(leaf_size_bytes) || leaf_size_bytes < 1) {
							const error = new Error("bad leaf_size_bytes")
							error.value = leaf_size_bytes
							throw error
						}

						if (!Number.isInteger(key_bytes) || key_bytes < 1) {
							const error = new Error("bad key_bytes")
							error.value = key_bytes
							throw error
						}

						if (!Number.isInteger(value_bytes) || value_bytes < 1) {
							const error = new Error("bad value_bytes")
							error.value = value_bytes
							throw error
						}

						if (!Number.isInteger(root) || root < 1) {
							const error = new Error("bad root")
							error.value = root
							throw error
						}

						if (!Number.isInteger(first) || first < 1) {
							const error = new Error("bad first")
							error.value = first
							throw error
						}

						if (!Number.isInteger(last) || last < 1) {
							const error = new Error("bad last")
							error.value = last
							throw error
						}

						if (!Number.isInteger(next_id) || next_id < 2) {
							const error = new Error("bad next_id")
							error.value = next_id
							throw error
						}
					}

					this._node_bytes = node_size_bytes + (node_order - 1) * key_bytes + node_order * PB
					this._leaf_bytes = leaf_size_bytes + 2 * PB + leaf_order * (key_bytes + value_bytes)
					this._readNodeSize = (b) => b.readUIntBE(0, node_size_bytes)
					this._writeNodeSize = (b, x) => { b.writeUIntBE(x, 0, node_size_bytes) }
					this._readLeafSize = (b) => b.readUIntBE(0, leaf_size_bytes)
					this._writeLeafSize = (b, x) => { b.writeUIntBE(x, 0, leaf_size_bytes) }

					if (validate) {
						// check if keys are sorted using fn
					}
				} catch (error) {
					error.code = Constants.CORRUPPTED
					throw error
				}
			}

			// this._node_pool = new Pool()
			// for (let i = 0; i < 20; i++) {
			// 	this._node_pool.release(this._makeNode())
			// }
			// this._leaf_pool = new Pool()
			// for (let i = 0; i < 20; i++) {
			// 	this._leaf_pool.release(this._makeLeaf())
			// }

			this._node_lru = new Lru(10)
			this._leaf_lru = new Lru(10)

			this._fn = fn
			this._state = Constants.STATE.OPEN
		} catch (error) {
			try {
				await this._lock_file.release()
			} catch (err) { }
			throw error
		}
	}

	async close () {
		if (this._state !== Constants.STATE.OPEN) {
			const error = new Error("Cannot call close from this state")
			error.code = Constants.BAD_STATE
			error.state = this._state
			throw error
		}

		this._state = Constants.STATE.CLOSING

		await this._lock_file.release()

		this._fn = null
		this._meta = null
		this._node_bytes = null
		this._leaf_bytes = null
		this._readNodeSize = null
		this._writeNodeSize = null
		this._readLeafSize = null
		this._writeLeafSize = null

		this._state = Constants.STATE.CLOSED
	}

	async has (key) {
		try {
			return this._has(this._meta.root, key, 0)
		} catch (error) {
			try {
				await this._lock_file.release()
			} catch (err) { }
			throw error
		}
	}

	async _has (id, key, depth) {
		const is_leaf = depth === this._meta.depth
		const node = await (is_leaf ? this._readLeaf(id) : this._readNode(id))
		const index = __bisect(node.keys, 0, node.size, key, this._fn)
		return is_leaf
			? index < node.size && this._fn(node.keys[index], key) === 0
			: this._has(node.children[index], key, depth + 1)
	}

	async get (key) {
		try {
			return this._get(this._meta.root, key, 0)
		} catch (error) {
			try {
				await this._lock_file.release()
			} catch (err) { }
			throw error
		}
	}

	async _get (id, key, depth) {
		const is_leaf = depth === this._meta.depth
		const node = await (is_leaf ? this._readLeaf(id) : this._readNode(id))
		const index = __bisect(node.keys, 0, node.size, key, this._fn)
		return is_leaf
			? index < node.size && this._fn(node.keys[index], key) === 0
				? node.values[index]
				: undefined
			: this._get(node.children[index], key, depth + 1)
	}

	async set (key, value) {
		try {
			const promises = []
			const changed = this._set(this._meta.root, key, value, 0, promises)
			if (changed) { promises.push(this._writeMeta()) }
			await Promise.all(promises)
			return changed
		} catch (error) {
			try {
				await this._lock_file.release()
			} catch (err) { }
			throw error
		}
	}

	async _set (id, key, value, depth, promises) {
		const is_leaf = depth === this._meta.depth
		const node = await (is_leaf ? this._readLeaf(id) : this._readNode(id))
		const index = __bisect(node.keys, 0, node.size, key, this._fn)

		if (is_leaf) {
			// Overwrite
			if (index < node.size && this._fn(node.keys[index], key) === 0) {
				this._spliceValues(node, index, 1, value)
				promises.push(this._writeLeaf(node))
				return false
			}

			// Insert

			this._meta.size += 1

			this._spliceKeys(node, index, 0, key)
			this._spliceValues(node, index, 0, value)
			node.size += 1

			if (node.size <= this._meta.leaf_order) {
				promises.push(this._writeLeaf(node))
				return true
			}

			// Split Leaf
			const left = node
			const right = this._makeNewLeaf()
			const parent_key = this._balanceLeaves(left, right)

			left.prev = node.prev
			right.next = node.next
			left.next = right.id
			right.prev = left.id
			if (id === this._meta.last) { this._meta.last = right.id }

			promises.push(this._writeLeaf(left))
			promises.push(this._writeLeaf(right))

			if (id !== this._meta.root) {
				return { key: parent_key, child: right._id }
			}

			// New Root
			const new_root = this._makeNode()
			this._spliceKeys(new_root, 0, 0, parent_key)
			this._spliceChildren(new_root, 0, 0, left._id, right._id)
			new_root.size = 2
			promises.push(this._writeNode(new_root))

			this._meta.root = new_root
			this._meta.depth += 1
			return true
		}

		// Recurse
		const child_id = readPointer(node.children[index])
		const result = this._set(child_id, key, value, depth + 1, promises)
		if (result.key === undefined) { return result }

		this._spliceKeys(node, index, 0, result.key)
		this._spliceChildren(node, index, 0, result.child)
		node.size += 1

		if (node.size < this._meta.node_order) {
			promises.push(this._writeNode(node))
			return true
		}

		// Split Node
		const left = node
		const right = this._makeNode()
		const parent_key = this._balanceNodes(left, right)

		promises.push(this._writeNode(left))
		promises.push(this._writeNode(right))

		if (id !== this._meta.root) {
			return { key: parent_key, child: right._id }
		}

		// New Root
		const new_root = this._makeNewNode()
		this._spliceKeys(new_root, 0, 0, parent_key)
		this._spliceChildren(new_root, 0, 0, left._id, right._id)
		new_root.size = 2
		promises.push(this._writeNode(new_root))

		this._meta.root = new_root
		this._meta.depth += 1
		return true
	}

	async delete (key, value) {
		try {
			const promises = []
			const changed = this._delete(this._meta.root, key, value, 0, promises)
			if (changed) { promises.push(this._writeMeta()) }
			await Promise.all(promises)
			return changed
		} catch (error) {
			try {
				await this._lock_file.release()
			} catch (err) { }
			throw error
		}
	}

	async _delete (id, parent, index_in_parent, key, depth, promises) {
		const is_leaf = depth === this._meta.depth
		const node = await (is_leaf ? this._readLeaf(id) : this._readNode(id))
		const index = __bisect(node.keys, 0, node.size, key, this._fn)

		if (is_leaf) {
			// Not Found
			if (index < node.size && this._fn(node.keys[index], key) !== 0) { return false }

			// Delete

			this._meta.size -= 1

			this._spliceKeys(node, index, 1)
			this._spliceValues(node, index, 1)
			node.size -= 1

			if (id === this._meta.root || node.size >= Math.ceil(this._order / 2)) {
				promises.push(this._writeLeaf(node))
				return true
			}

			if (parent.size === 1) {
				promises.push(this._writeLeaf(node))
				return { index: 0 }
			}

			const left_index = Math.max(0, index_in_parent - 1)
			const right_index = left_index + 1
			const left = this._readLeaf(parent.children[left_index]) // x
			const right = this._readLeaf(parent.children[right_index]) // x

			// Merge Leaves
			if (left.size + right.size < this._order) {
				this._spliceNodeKeys(left, left.size, 0, right, 0, right.size)
				this._spliceNodeValues(left, left.size, 0, right, 0, right.size)
				left.size += right.size

				left.next = right.next
				if (right === this._last) { this._last = left.id }

				promises.push(this._writeLeaf(left))
				promises.push(this._deleteFile(right))
				return { index: right_index }
			}

			// Rotate Leaves
			const parent_key = this._balanceLeaves(left, right)
			this._spliceKeys(parent, left_index, 1, parent_key)

			promises.push(this._writeLeaf(left))
			promises.push(this._writeLeaf(right))
			return true
		}

		// Recurse
		const result = this._delete(node.children[index], node, index, key)
		if (result.index === undefined) { return result }

		this._spliceKeys(node, result.index - 1, 1)
		this._spliceChildren(node, result.index, 1)
		node.size -= 1

		// Delete Root
		if (id === this._root) {
			let root = node
			while (this._meta.depth > 0 && root.size === 1) {
				this._deleteFile(root)
				this._meta.depth -= 1
				this._meta.root = root.children[0] // x
				root = this._meta.depth === 0
					? await this._readLeaf(this._meta.root)
					: await this._readNode(this._meta.root)
			}

			return true
		}

		if (node.size >= Math.ceil(this._order / 2)) {
			promises.push(this._writeLeaf(node))
			return true
		}

		if (parent.size === 1) {
			promises.push(this._writeLeaf(node))
			return { index: 0 }
		}

		const left_index = Math.max(0, index_in_parent - 1)
		const right_index = left_index + 1
		const left = this._readNode(parent.children[left_index]) // x
		const right = this._readNode(parent.children[right_index]) // x

		// Merge Nodes
		if (left.size + right.size < this._order) {
			this._spliceNodeKeys(left, left.size, 0, parent, left_index, 1)
			this._spliceNodeKeys(left, left.size + 1, 0, right, 0, right.size - 1)
			this._spliceNodeChildren(left, left.size, 0, right, 0, right.size)
			left.size += right.size

			promises.push(this._writeLeaf(left))
			promises.push(this._deleteLeaf(right))
			return { index: right_index }
		}

		// Rotate Nodes
		const parent_key = this._balanceNodes(left, right, parent.keys[left_index])
		this._spliceKeys(parent, left_index, 1, parent_key)

		promises.push(this._writeLeaf(left))
		promises.push(this._writeLeaf(right))
		return true
	}

	_balanceLeaves (left, right) {
		const avg = Math.floor((left.size + right.size) / 2)
		if (left.size < right.size) {
			const num = right.size - avg

			this._spliceNodeKeys(left, left.size, 0, right, 0, num)
			this._spliceNodeValues(left, left.size, 0, right, 0, num)
			left.size += num

			this._spliceKeys(right, 0, num)
			this._spliceValues(right, 0, num)
			right.size -= num
		} else {
			const num = left.size - avg

			this._spliceNodeKeys(right, 0, 0, left, avg, left.size)
			this._spliceNodeValues(right, 0, 0, left, avg, left.size)
			right.size += num

			left.size = avg
		}
		return left.keys[left.size - 1]
	}

	_balanceNodes (left, right, parent_key) {
		let new_parent_key
		const avg = Math.floor((left.size + right.size) / 2)
		if (left.size < right.size) {
			const num = right.size - avg

			this._spliceKeys(left, left.size, 0, parent_key)
			this._spliceNodeKeys(left, left.size + 1, 0, right, 0, num - 1)
			this._spliceNodeChildren(left, left.size, 0, right, 0, num)
			left.size += num

			new_parent_key = right.keys[num - 1]

			this._spliceKeys(right, 0, num)
			this._spliceChildren(right, 0, num)
			right.size -= num
		} else {
			const num = right.size - avg

			this._spliceKeys(right, 0, 0, parent_key)
			this._spliceNodeKeys(right, 0, 0, left, avg, left.size - 1)
			this._spliceNodeChildren(right, 0, 0, left, avg, left.size)
			right.size += num

			new_parent_key = left.keys[avg - 1]

			left.size -= num
		}
		return new_parent_key
	}

	_spliceNodeKeys (dst, dst_index, n, src, src_index, m) {
		this._spliceBuffer(dst._keys, dst_index, n, src._keys, src_index, m, this._meta.key_bytes)
	}

	_spliceNodeValues (dst, dst_index, n, src, src_index, m) {
		this._spliceBuffer(dst._values, dst_index, n, src._values, src_index, m, this._meta.value_bytes)
	}

	_spliceNodeChildren (dst, dst_index, n, src, src_index, m) {
		this._spliceBuffer(dst._children, dst_index, n, src._children, src_index, m, PB)
	}

	_spliceKeys (dst, dst_index, n, ...keys) {
		this._spliceBuffer(dst._keys, dst_index, n, Buffer.concat(keys), 0, 1, this._meta.key_bytes)
	}

	_spliceValues (dst, dst_index, n, ...values) {
		this._spliceBuffer(dst._values, dst_index, n, Buffer.concat(values), 0, 1, this._meta.value_bytes)
	}

	_spliceChildren (dst, dst_index, n, ...children) {
		this._spliceBuffer(dst._children, dst_index, n, Buffer.concat(children), 0, 1, PB)
	}

	_spliceBuffer (dst, dst_index, n, src, src_index, m, s) {
		move: {
			if (n === m) { break move }
			const { size } = dst
			if (size === 0) { break move }
			const dst_move_start = (dst_index + n) * s
			const dst_move_end = size * s
			if (dst_move_start === dst_move_end) { break move }
			const dst_move_target = (dst_index + m) * s
			dst.copy(dst, dst_move_target, dst_move_start, dst_move_end)
		}
		copy: {
			if (m === 0) { break copy }
			const src_copy_start = src_index * s
			const src_copy_end = (src_index + m) * s
			const dst_copy_target = dst_index * s
			src.copy(dst, dst_copy_target, src_copy_start, src_copy_end)
		}
	}

	_makeNode (id) {
		const _id = Buffer.allocUnsafe(PB)
		writePointer(_id, id)

		const path = Path.join(this._location, id.toString())

		const { node_order, node_size_bytes, key_bytes } = this._meta

		const _node = Buffer.allocUnsafe(this._node_bytes)
		let start
		let end

		start = 0
		end = node_size_bytes
		const _size = _node.slice(start, end)

		const keys_start = node_size_bytes
		const keys_end = keys_start + (node_order - 1) * key_bytes
		const _keys = _node.slice(keys_start, keys_end)

		const children_start = keys_end
		const children_end = children_start + node_order * PB
		const _children = _node.slice(children_start, children_end)

		const keys = new Array(node_order - 1)
		for (let i = 0; i < node_order - 1; i++) {
			start = end
			end += key_bytes
			keys[i] = _node.slice(start, end)
		}

		const children = new Array(node_order)
		for (let i = 0; i < node_order; i++) {
			start = end
			end += PB
			children[i] = _node.slice(start, end)
		}

		return { id, _id, path, _node, _size, size: 0, _keys, keys, _children, children }
	}

	_makeNewNode () {
		const id = this._meta.next_id++
		return this._makeNode(id)
	}

	_makeLeaf (id) {
		const _id = Buffer.allocUnsafe(PB)
		writePointer(_id, id)

		const path = Path.join(this._location, id.toString(16))

		const { leaf_order, leaf_size_bytes, key_bytes, value_bytes } = this._meta

		const _node = Buffer.allocUnsafe(this._leaf_bytes)
		let start
		let end

		start = 0
		end = leaf_size_bytes
		const _size = _node.slice(start, end)

		start = end
		end += PB
		const _prev = _node.slice(start, end)

		start = end
		end += PB
		const _next = _node.slice(start, end)

		const keys_start = leaf_size_bytes + 2 * PB
		const keys_end = keys_start + leaf_order * key_bytes
		const _keys = _node.slice(keys_start, keys_end)

		const values_start = keys_end
		const values_end = values_start + leaf_order * value_bytes
		const _values = _node.slice(values_start, values_end)

		const keys = new Array(leaf_order - 1)
		for (let i = 0; i < leaf_order; i++) {
			start = end
			end += key_bytes
			keys[i] = _node.slice(start, end)
		}

		const values = new Array(leaf_order)
		for (let i = 0; i < leaf_order; i++) {
			start = end
			end += value_bytes
			values[i] = _node.slice(start, end)
		}

		return { id, _id, path, _node, _size, size: 0, _prev, prev: 0, _next, next: 0, _keys, keys, _values, values }
	}

	_makeNewLeaf () {
		const id = this._meta.next_id++
		return this._makeLeaf(id)
	}

	async _readNode (id) {
		let node = this._node_lru.get(id)
		if (node) { return node }

		node = this._makeNode(id)
		await this._readFromFile(node)
		node.size = this._readNodeSize(node._size)

		this._node_lru.set(id, node)
		return node
	}

	async _readLeaf (id) {
		let node = this._leaf_lru.get(id)
		if (node) { return node }

		node = this._makeLeaf(id)
		await this._readFromFile(node)
		node.size = this._readLeafSize(node._size)

		this._leaf_lru.set(id, node)
		return node
	}

	async _readFromFile (node) {
		const fd = await Fsp.open(node.path, 'r')
		await fd.read(node._node, 0, node._node.length, 0)
		await fd.close()
	}

	async _writeNode (node) {
		this._writeNodeSize(node._size, node.size)
		await this._writeToFile(node)
	}

	async _writeLeaf (node) {
		this._writeLeafSize(node._size, node.size)
		writePointer(node._prev, node.prev)
		writePointer(node._next, node.next)
		await this._writeToFile(node)
	}

	async _writeToFile (node) {
		const fd = await Fsp.open(node.path, 'w')
		await fd.write(node._node)
		await fd.close()
	}

	async _writeMeta () {
		await Fsp.writeFile(this._location_meta, JSON.stringify(this._meta))
	}

	async _deleteFile (node) {
		await Fsp.unlink(node.path)
	}

	* keys (options = {}) {
		const {
			lt, lte, gt, gte,
			reverse, limit,
		} = options

		const [ before_start, _start, before_end, _end ] = reverse
			? [ lt, lte, gte, gt ]
			: [ gt, gte, lte, lt ]
		const start
			= _start !== undefined ? _start
			: before_start !== undefined ? before_start + 1
			: 0
		const end
			= _end !== undefined ? _end
			: before_end !== undefined ? before_end + 1
			: limit !== undefined ? start + limit
			: this.length
		const inc = reverse ? -1 : 1

		for (let i = start; i < end; i += inc) {
			yield i
		}
	}

	async * entries (options = {}) {
		for await (const key of this.keys(options)) {
			yield [ key, await this.get(key) ]
		}
	}

	async * values (options = {}) {
		for await (const key of this.keys(options)) {
			yield await this.get(key)
		}
	}
}

module.exports = { IndexDB }
