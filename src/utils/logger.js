// src/utils/logger.js
import winston from 'winston';
import chalk from 'chalk';

// Custom format for console output with colors
const consoleFormat = winston.format.printf(({ level, message, timestamp }) => {
  const ts = chalk.gray(`[${timestamp}]`);

  let coloredLevel;
  switch(level) {
    case 'error':
      coloredLevel = chalk.red.bold(`[${level.toUpperCase()}]`);
      break;
    case 'warn':
      coloredLevel = chalk.yellow.bold(`[${level.toUpperCase()}]`);
      break;
    case 'info':
      coloredLevel = chalk.blue.bold(`[${level.toUpperCase()}]`);
      break;
    default:
      coloredLevel = chalk.white.bold(`[${level.toUpperCase()}]`);
  }

  // Handle multiline messages
  const formattedMessage = message.toString().split('\n').join('\n    ');

  return `${ts} ${coloredLevel}: ${formattedMessage}`;
});

// Custom format for file output (without colors)
const fileFormat = winston.format.printf(({ level, message, timestamp }) => {
  return `[${timestamp}] [${level.toUpperCase()}]: ${message}`;
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss'
        }),
        consoleFormat
      )
    }),
    new winston.transports.File({
      filename: 'error.log',
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        fileFormat
      )
    }),
    new winston.transports.File({
      filename: 'combined.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        fileFormat
      )
    })
  ]
});

// Add custom success level
logger.success = (message) => {
  const ts = chalk.gray(`[${new Date().toISOString().replace('T', ' ').slice(0, 19)}]`);
  const level = chalk.green.bold('[SUCCESS]');
  console.log(`${ts} ${level}: ${message}`);
};

export default logger;