export default {
	testEnvironment: 'node',
	transform: {},
	moduleNameMapper: {},
	testMatch: ['**/test/**/*.integration.test.js'],
	testPathIgnorePatterns: ['/node_modules/'],
	setupFiles: ['<rootDir>/test/setup.js']
};
