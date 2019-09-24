/* eslint-disable */
var webpack = require('webpack');

module.exports = {
  devtool: 'source-map',
  entry: {
    app: __dirname + '/index.js'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    ]
  },
  output: {
    path: __dirname + '/build/',
    filename: '[name].js',
    publicPath: 'http://localhost:8000/build'
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        'NODE_ENV': '"development"'
      }
    }),
    new webpack.NoEmitOnErrorsPlugin(),
    new webpack.HotModuleReplacementPlugin()
  ],
  devServer: {
    contentBase: __dirname,
    historyApiFallback: true,
    hot: true,
    inline: true,
    port: 8000,
    progress: true,
    stats: {
      cached: false
    }
  }
};
