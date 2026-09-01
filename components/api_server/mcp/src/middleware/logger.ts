import morgan from "morgan";
import express from "express";
import util from "util";
import chalk from "chalk";
import { LOGGER_ENABLE_HEADERS, LOGGER_ENABLE_BODY } from "../config/env";

morgan.token("date-jst", () => {
  const date = new Date();
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  
  const timeStr = formatter.format(date).replace(" ", "T") + "+09:00";
  return chalk.gray(timeStr);
});

morgan.token("req-headers", (req: express.Request) => {
  return util.inspect(req.headers, { colors: true, depth: null });
});

morgan.token("req-body", (req: express.Request) => {
  return Object.keys(req.body || {}).length 
    ? util.inspect(req.body, { colors: true, depth: null }) 
    : chalk.gray("{}");
});

morgan.token("colored-method", (req: express.Request) => {
  return chalk.yellow.bold(req.method);
});

morgan.token("colored-status", (_req, res) => {
  const status = res.statusCode;
  if (status >= 500) return chalk.red.bold(status);
  if (status >= 400) return chalk.yellow.bold(status);
  return chalk.green.bold(status);
});

export const mcpLogger = morgan((tokens, req, res) => {
  const date = tokens["date-jst"](req, res);
  const method = tokens["colored-method"](req, res);
  const url = tokens.url(req, res);
  const status = tokens["colored-status"](req, res);
  const time = chalk.magenta(`${tokens["response-time"](req, res)} ms`);
  const ip = tokens["remote-addr"](req, res);
  const headers = tokens["req-headers"](req, res);
  const body = tokens["req-body"](req, res);
  const httpVer = tokens["http-version"](req, res);

  return (
    `${date} ${chalk.cyanBright("[INFO]")} IP: ${ip} | ${method} ${url} HTTP/${httpVer} | Status: ${status} | Time: ${time}\n` +
    `${chalk.cyanBright.bold("Headers:")} ${LOGGER_ENABLE_HEADERS ? headers : chalk.gray("-")}\n` +
    `${chalk.cyanBright.bold("Body:")} ${LOGGER_ENABLE_BODY ? body : chalk.gray("-")}\n` +
    chalk.gray("---")
  );
});
