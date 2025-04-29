# Project Documentation

## Overview

This project is designed to handle and process transaction data sent via Telegram. It receives messages, parses transaction data, saves it to a database, and generates reports. The code also handles error logging and sends reports to Telegram.

## Key Components

### 1. **Telegram Update Handling**

The core of the project revolves around listening for Telegram updates. It processes incoming `POST` requests with updates, validates the message content, and performs various actions depending on the text received.

### 2. **Transaction Parsing**

Transaction data is parsed from the incoming messages. The system can handle two different formats of transaction data. It supports deposits and withdrawals, extracting information such as the bank name, account number, amounts, and branch codes.

### 3. **Database Integration**

The system uses D1 (Cloudflare's database) for storing both transaction and message data. Transactions are validated for duplicates before being saved, ensuring that no data is entered multiple times.

### 4. **Error Handling & Logging**

Error handling is built-in throughout the system, with detailed logging sent to Telegram for transparency. It also includes retry logic for sending logs in case of temporary failures.

### 5. **Transaction Reports**

The system can generate detailed reports for all transactions. These reports include summary statistics and breakdowns by tags and locations. The reports can be filtered by tags and locations, providing flexibility for users.

## Environment Variables

- **DB**: D1Database instance for storing transaction data and messages.
- **TELEGRAM_TOKEN**: The Telegram bot token used to send messages to Telegram.

## API Workflow

### 1. **Receiving Updates**

- The system listens for `POST` requests that contain a message from Telegram.
- It checks for a valid chat ID and message content. If either is missing, it sends an error log to Telegram and returns a 200 OK status.

### 2. **Processing Commands**

- If the message matches the "show all" command, the system generates a transaction report based on optional filters (tag and location).
- If the message contains transaction data, it is parsed, validated, and either saved or flagged as an error (for example, if it's in an incorrect format).

### 3. **Saving Data**

- Each valid message is saved to the database for record-keeping.
- If a transaction is identified, it is checked for duplication before being saved to the database.

### 4. **Logging Errors and Notifications**

- Errors encountered during message parsing, transaction saving, or report generation are logged and sent to Telegram.
- The system uses retry logic to handle temporary failures when sending logs to Telegram.

## Functions

### `fetch(request: Request, env: Env): Promise<Response>`
Handles the incoming request, processes the Telegram update, and takes action based on the message content.

### `checkForDuplicateTransaction(d1Database: D1Database, parsedData: TransactionData): Promise<boolean>`
Checks if a transaction is a duplicate by matching key attributes in the database.

### `sendLogToTelegram(env: Env, chatId: number, message: string, level: 'info' | 'error', context?: Record<string, any>): Promise<void>`
Sends a log message to Telegram. It supports splitting long messages into chunks and retries sending on failure.

### `saveMessageToD1(env: Env, chatId: number, message: string): Promise<void>`
Saves the incoming message to the database.

### `saveTransactionToD1(env: Env, chatId: number, parsedData: TransactionData): Promise<void>`
Saves transaction data to the database, after checking for duplicates.

### `generateTransactionReport(env: Env, chatId: number, tag?: string, location?: string): Promise<TransactionReport>`
Generates a detailed transaction report, including summaries and breakdowns by tag and location.

### `parseCommandParams(params: string): { tag?: string; location?: string }`
Parses optional filters for generating transaction reports from a command.

### `formatReport(report: TransactionReport): string`
Formats the transaction report into a string that can be sent to Telegram.

## Error Handling

The system uses a consistent approach to error handling, including:

- **Parsing Errors**: If the transaction data cannot be parsed, a detailed error message is sent to Telegram, along with an example of the correct format.
- **Duplicate Transactions**: If a duplicate transaction is detected, an error is logged, and the user is notified.
- **Database Errors**: If there's a failure while saving data, the error is logged, and a response is returned with a relevant error message.

## Example Use Case

A user sends a transaction message in the following format:

```
بانک تجارت
حساب: 1234
واریز: 1,000,000 ریال
از طریق: شعبه
کدشعبه: 2080
مانده: 5,000,000 ریال
1404/02/08
23:51
CAFEnAME #Cafe
```

The system processes this message, parses the transaction data, and responds with a confirmation message:

```
✅ تراکنش با موفقیت تجزیه شد!
📋 قالب: قالب ۱
💸 واریز: 1,000,000 ریال
📅 تاریخ: 1404/02/08
```

If the data is incorrect, it will notify the user to correct the format and provide examples.

## Conclusion

This system provides a robust solution for handling and processing transaction data through Telegram. With built-in error handling, transaction validation, and detailed reporting, it offers an efficient way to manage and analyze transactions directly within a Telegram interface.