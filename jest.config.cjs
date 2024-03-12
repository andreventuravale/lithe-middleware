const fs = require('node:fs')

const config = JSON.parse(fs.readFileSync(`${__dirname}/.swcrc`, 'utf-8'))

module.exports = {
	transform: {
		'^.+\\.(t|j)sx?$': [
			'@swc/jest',
			{ ...config /* custom configuration in Jest */ },
		],
	},
}
