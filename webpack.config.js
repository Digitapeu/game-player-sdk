const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');
const WebpackObfuscator = require('webpack-obfuscator');

const terserOptions = {
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
};

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  // ============================================================
  // SDK Shim (runs inside game iframe, domain-locked)
  // ============================================================
  const sdkConfig = {
    name: 'sdk',
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
        new TerserPlugin({ terserOptions, extractComments: false }),
      ],
    },
    plugins: isProduction
      ? [
          new WebpackObfuscator(
            {
              stringArray: true,
              stringArrayThreshold: 0.8,
              stringArrayEncoding: ['base64'],
              stringArrayWrappersCount: 1,
              stringArrayWrappersType: 'variable',
              rotateStringArray: true,
              shuffleStringArray: true,
              splitStrings: false,
              controlFlowFlattening: false,
              deadCodeInjection: false,
              identifierNamesGenerator: 'hexadecimal',
              renameGlobals: true,
              renameProperties: false,
              selfDefending: false,
              debugProtection: false,
              disableConsoleOutput: true,
              domainLock: [
                '.wam.app',
                'win.wam.app',
                'play.wam.app',
                'game.digitap.eu',
                'game.wam.app',
                'files.digitap.eu',
                '*.wam.app',
                '*.digitap.eu',
                'digitap.eu',
                'localhost',
                '127.0.0.1',
              ],
              domainLockRedirectUrl: 'about:blank',
              numbersToExpressions: false,
              transformObjectKeys: false,
              unicodeEscapeSequence: false,
              compact: true,
              simplify: true,
              target: 'browser',
            },
            []
          ),
        ]
      : [],
  };

  // ============================================================
  // Security Worker (runs in GameBox's Web Worker thread)
  // NO domain lock - runs in GameBox origin, not game iframe origin
  // ============================================================
  const workerConfig = {
    name: 'worker',
    entry: './src/worker/index.ts',
    devtool: isProduction ? false : 'source-map',
    target: 'webworker',
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
      filename: 'security-worker.min.js',
      path: path.resolve(__dirname, 'dist'),
    },
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({ terserOptions, extractComments: false }),
      ],
    },
    plugins: isProduction
      ? [
          new WebpackObfuscator(
            {
              stringArray: true,
              stringArrayThreshold: 0.8,
              stringArrayEncoding: ['base64'],
              stringArrayWrappersCount: 1,
              stringArrayWrappersType: 'variable',
              rotateStringArray: true,
              shuffleStringArray: true,
              splitStrings: false,
              controlFlowFlattening: false,
              deadCodeInjection: false,
              identifierNamesGenerator: 'hexadecimal',
              renameGlobals: true,
              renameProperties: false,
              selfDefending: false,
              debugProtection: false,
              disableConsoleOutput: true,
              // NO domainLock - Worker runs on GameBox origin
              numbersToExpressions: false,
              transformObjectKeys: false,
              unicodeEscapeSequence: false,
              compact: true,
              simplify: true,
              target: 'browser',
            },
            []
          ),
        ]
      : [],
  };

  return [sdkConfig, workerConfig];
};
