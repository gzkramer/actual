export default {
  test: {
    exclude: ['**/node_modules/**', '**/build/**'],
    globals: true,
    reporters: process.env.CI
      ? [
          'default',
          [
            'junit',
            {
              outputFile: './test-results/junit.xml',
              suiteName: 'categorize-service',
            },
          ],
        ]
      : ['default'],
  },
};
