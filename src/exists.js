const Fs = require('fs')

const exists = (path) => new Promise((resolve) => {
	Fs.access(path, (error) => { resolve(!error) })
})

module.exports = { exists }
