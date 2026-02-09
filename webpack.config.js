const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const WebpackObfuscator = require('webpack-obfuscator');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: './src/index.ts',
    devtool: isProduction ? false : 'source-map',
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
      ],
    },
    resolve: {
      extensions: ['.tsx', '.ts', '.js'],
    },
    output: {
      filename: 'main.min.4.js',
      path: path.resolve(__dirname, 'dist'),
    },
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            mangle: {
              toplevel: true,
              properties: { regex: /^_/ },
            },
            compress: {
              drop_console: true,
              drop_debugger: true,
              pure_funcs: ['console.log', 'console.debug', 'console.info'],
              passes: 3,
              toplevel: true,
              unsafe_math: true,
              unsafe_methods: true,
              booleans_as_integers: true,
              collapse_vars: true,
              reduce_vars: true,
              inline: true,
            },
            format: { comments: false, ecma: 2020 },
            ecma: 2020,
          },
          extractComments: false,
        }),
      ],
    },
    plugins: isProduction
      ? [
          new WebpackObfuscator(
            {
              // === LEAN BUT SECURE (~50-70KB) ===
              
              // String protection - base64 is smaller than RC4
              stringArray: true,
              stringArrayThreshold: 0.8, // 80% of strings (keeps some inline)
              stringArrayEncoding: ['base64'], // Smaller than RC4
              stringArrayWrappersCount: 1,
              stringArrayWrappersType: 'variable',
              rotateStringArray: true,
              shuffleStringArray: true,
              splitStrings: false, // Disable - adds size
              
              // Control flow - DISABLED (biggest size impact)
              controlFlowFlattening: false,
              deadCodeInjection: false,
              
              // Identifier obfuscation - keep this
              identifierNamesGenerator: 'hexadecimal',
              renameGlobals: true,
              renameProperties: false,
              
              // Anti-tampering - keep domain lock, disable expensive checks
              selfDefending: false, // Disable - adds size
              debugProtection: false, // Disable - adds size
              disableConsoleOutput: true,
              
              // Domain locking - CRITICAL, keep this
              domainLock: [
                '.wam.app', // Wildcard for all subdomains
                'wam.eu',
                'digitap.eu',
                'localhost',
                '127.0.0.1',
              ],
              domainLockRedirectUrl: 'about:blank',
              
              // Disable expensive transforms
              numbersToExpressions: false,
              transformObjectKeys: false,
              unicodeEscapeSequence: false,
              
              // Output
              compact: true,
              simplify: true,
              target: 'browser',
            },
            []
          ),
        ]
      : [],
  };
};
