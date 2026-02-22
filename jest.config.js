export default {
	testEnvironment: 'node',
	transform: {},
	moduleNameMapper: {},
	testMatch: ['**/test/**/*.test.js'],
	testPathIgnorePatterns: [
		'/node_modules/',
		'\\.integration\\.test\\.js$'
	],
	setupFiles: ['<rootDir>/jest.setup.js']
};
