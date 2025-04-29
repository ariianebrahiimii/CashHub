import { parseTransactionData, TransactionData, ParseError } from './parser';

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text: string;
  };
}

interface Env {
  DB: D1Database;
  TELEGRAM_TOKEN: string;
}

interface TransactionReport {
  totalAmount: number;
  totalWithdrawal: number;
  totalDeposit: number;
  transactionCount: number;
  transactions: TransactionData[];
  byTag: Record<string, { count: number; totalWithdrawal: number; totalDeposit: number }>;
  byLocation: Record<string, { count: number; totalWithdrawal: number; totalDeposit: number; deposits: TransactionData[]; withdrawals: TransactionData[] }>;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;
const MAX_MESSAGE_LENGTH = 4000; // Slightly below Telegram's 4096 limit for safety

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let chatId: number = 0;
    try {
      if (!env.DB || !env.TELEGRAM_TOKEN) {
        const errorMsg = 'Missing environment variables (DB or TELEGRAM_TOKEN)';
        await sendLogToTelegram(env, chatId, errorMsg, 'error');
        return new Response(JSON.stringify({ error: 'Server configuration error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (request.method !== 'POST') {
        const errorMsg = 'Method not allowed';
        await sendLogToTelegram(env, chatId, errorMsg, 'error');
        return new Response(errorMsg, { status: 405 });
      }

      const update: TelegramUpdate = await request.json();
      if (!update?.message?.chat?.id || !update.message.text) {
        const errorMsg = 'Invalid Telegram update';
        await sendLogToTelegram(env, chatId, errorMsg, 'error');
        return new Response(JSON.stringify({ error: errorMsg }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      chatId = update.message.chat.id;
      const receivedText = update.message.text.trim();

      await saveMessageToD1(env, chatId, receivedText);

      const commandMatch = receivedText.match(/^show all|Show all|all\s*(.*)$/i);
      if (commandMatch) {
        const params = commandMatch[1] || '';
        const filters = parseCommandParams(params);
        const report = await generateTransactionReport(env, chatId, filters.tag, filters.location);
        const reportMessage = formatReport(report);
        await sendLogToTelegram(env, chatId, reportMessage, 'info');
        return new Response(JSON.stringify({ status: 'Report generated' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let parsedData: TransactionData;
      try {
        parsedData = parseTransactionData(receivedText);
        const amountField = parsedData.transaction_type === 'deposit' ? 'واریز' : 'برداشت';
        const amountValue = parsedData.transaction_type === 'deposit' 
          ? parsedData.deposit_amount 
          : parsedData.withdrawal_amount;
        await sendLogToTelegram(
          env,
          chatId,
          `✅ تراکنش با موفقیت تجزیه شد!\n` +
          `📋 قالب: ${parsedData.bank_name === 'Unknown' ? 'قالب ۲' : 'قالب ۱'}\n` +
          `💸 ${amountField}: ${amountValue?.toLocaleString('fa-IR')} ریال\n` +
          `📅 تاریخ: ${parsedData.date}`,
          'info'
        );
      } catch (error) {
        const errorMessage = error instanceof ParseError ? error.message : `خطا در تجزیه تراکنش: ${error.message}`;
        await sendLogToTelegram(
          env,
          chatId,
          `❌ خطا در تجزیه تراکنش: ${errorMessage}\n` +
          `لطفاً تراکنش را در قالب صحیح ارسال کنید:\n` +
          `مثال واریز (قالب ۱):\n*بانک تجارت*\nحساب: 1234\nواریز: 1,000,000 ریال\nاز طریق: شعبه\nکدشعبه: 2080\nمانده: 5,000,000 ریال\n1404/02/08\n23:51\nLoup #Cafe\n` +
          `مثال واریز (قالب ۲):\nحساب1234\nواریز1,000,000\nمانده5,000,000\n04/02/08-23:51\n#Cafe\n` +
          `مثال برداشت (قالب ۱):\n*بانک تجارت*\nحساب: 1234\nبرداشت: 1,000,000 ریال\nاز طریق: پایانه فروش\nمانده: 5,000,000 ریال\n1404/02/08\n23:51\nLoup #Cafe\n` +
          `مثال برداشت (قالب ۲):\nحساب1234\nبرداشت1,000,000\nمانده5,000,000\n04/02/08-23:51\n#Cafe`,
          'error',
          { receivedText }
        );
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      try {
        await saveTransactionToD1(env, chatId, parsedData);
        const amountField = parsedData.transaction_type === 'deposit' ? 'واریز' : 'برداشت';
        const amountValue = parsedData.transaction_type === 'deposit' 
          ? parsedData.deposit_amount 
          : parsedData.withdrawal_amount;
        await sendLogToTelegram(
          env,
          chatId,
          `✅ تراکنش با موفقیت ثبت شد!\n` +
          `🏦 بانک: ${parsedData.bank_name !== 'Unknown' ? parsedData.bank_name : 'نامشخص'}\n` +
          `💸 ${amountField}: ${amountValue?.toLocaleString('fa-IR')} ریال\n` +
          `💰 مانده: ${parsedData.balance.toLocaleString('fa-IR')} ریال` +
          (parsedData.branch_code ? `\n🏢 کد شعبه: ${parsedData.branch_code}` : ''),
          'info'
        );
      } catch (error) {
        const errorMessage = error.message === 'Duplicate transaction' 
          ? 'تراکنش تکراری است و قبلاً ثبت شده است'
          : `خطا در ذخیره تراکنش: ${error.message}`;
        await sendLogToTelegram(
          env,
          chatId,
          `❌ ${errorMessage}`,
          'error',
          { parsedData }
        );
        return new Response(JSON.stringify({ error: errorMessage }), {
          status: error.message === 'Duplicate transaction' ? 200 : 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify(parsedData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    } catch (error) {
      await sendLogToTelegram(
        env,
        chatId,
        `❌ خطای سرور: ${error.message}`,
        'error',
        { error }
      );
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};

async function checkForDuplicateTransaction(
  d1Database: D1Database,
  parsedData: TransactionData
): Promise<boolean> {
  let query = `
    SELECT COUNT(*) as count
    FROM transactions
    WHERE account_number = ?
      AND transaction_type = ?
      AND date = ?
      AND time = ?
      AND balance = ?`;
  const params = [
    parsedData.account_number,
    parsedData.transaction_type,
    parsedData.date,
    parsedData.time,
    parsedData.balance,
  ];

  if (parsedData.transaction_type === 'withdrawal') {
    query += ` AND withdrawal_amount = ?`;
    params.push(parsedData.withdrawal_amount);
  } else {
    query += ` AND deposit_amount = ?`;
    params.push(parsedData.deposit_amount);
  }

  const result = await d1Database.prepare(query)
    .bind(...params)
    .first();
  
  return result.count > 0;
}

async function sendLogToTelegram(
  env: Env,
  chatId: number,
  message: string,
  level: 'info' | 'error',
  context?: Record<string, any>
): Promise<void> {
  if (!env.TELEGRAM_TOKEN || !chatId) {
    console.error(`Cannot send log to Telegram: Missing TELEGRAM_TOKEN or invalid chatId`, {
      message,
      level,
      context,
      chatId,
    });
    return;
  }

  // Escape Markdown special characters
  const escapeMarkdown = (text: string): string => {
    return text.replace(/([_*`\[\\#])/g, '\\$1');
  };

  // Split message into chunks under MAX_MESSAGE_LENGTH
  const splitMessage = (text: string): string[] => {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = text.split('\n');

    for (const line of lines) {
      if (currentChunk.length + line.length + 1 > MAX_MESSAGE_LENGTH) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      currentChunk += line + '\n';
    }
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    return chunks;
  };

  const url = `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`;
  const logMessage = `*[${level === 'info' ? 'INFO' : 'ERROR'}]* ${escapeMarkdown(message)}\n` +
    (context ? `جزئیات:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`` : '');
  
  const messageChunks = splitMessage(logMessage);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      for (let i = 0; i < messageChunks.length; i++) {
        const chunk = messageChunks[i];
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: `[${i + 1}/${messageChunks.length}] ${chunk}`,
            parse_mode: 'Markdown',
          }),
        });

        if (!response.ok) {
          throw new Error(`Telegram API responded with status ${response.status} for chunk ${i + 1}`);
        }
      }
      return;
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        console.error(`Failed to send log to Telegram after ${MAX_RETRIES} attempts: ${error.message}`, {
          message,
          level,
          context,
          chatId,
        });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
}

async function saveMessageToD1(env: Env, chatId: number, message: string): Promise<void> {
  try {
    const query = `
      INSERT INTO messages (chat_id, message, timestamp)
      VALUES (?, ?, ?);
    `;
    await env.DB.prepare(query)
      .bind(chatId, message, Date.now())
      .run();
  } catch (error) {
    await sendLogToTelegram(
      env,
      chatId,
      `❌ خطا در ذخیره پیام: ${error.message}`,
      'error',
      { chatId, message }
    );
    throw new Error('Failed to save message to database');
  }
}

async function saveTransactionToD1(env: Env, chatId: number, parsedData: TransactionData): Promise<void> {
  const isDuplicate = await checkForDuplicateTransaction(env.DB, parsedData);
  if (isDuplicate) {
    throw new Error('Duplicate transaction');
  }

  try {
    const schemaCheck = await env.DB.prepare(`
      PRAGMA table_info(transactions);
    `).all();
    
    const columnExists = (name: string) => schemaCheck.results.some((column: any) => column.name === name);
    const hasChatId = columnExists('chat_id');
    const hasTransactionType = columnExists('transaction_type');
    const hasDepositAmount = columnExists('deposit_amount');
    const hasBranchCode = columnExists('branch_code');

    let query = `
      INSERT INTO transactions (
        ${hasChatId ? 'chat_id,' : ''} 
        bank_name, account_number, 
        ${hasTransactionType ? 'transaction_type,' : ''} 
        withdrawal_amount, 
        ${hasDepositAmount ? 'deposit_amount,' : ''} 
        transaction_method, 
        ${hasBranchCode ? 'branch_code,' : ''} 
        balance, date, time, location, tag, timestamp
      )
      VALUES (
        ${hasChatId ? '?, ' : ''} 
        ?, ?, 
        ${hasTransactionType ? '?, ' : ''} 
        ?, 
        ${hasDepositAmount ? '?, ' : ''} 
        ?, 
        ${hasBranchCode ? '?, ' : ''} 
        ?, ?, ?, ?, ?, ?
      );
    `;
    const params = [
      ...(hasChatId ? [chatId] : []),
      parsedData.bank_name,
      parsedData.account_number,
      ...(hasTransactionType ? [parsedData.transaction_type] : []),
      parsedData.withdrawal_amount,
      ...(hasDepositAmount ? [parsedData.deposit_amount] : []),
      parsedData.transaction_method,
      ...(hasBranchCode ? [parsedData.branch_code] : []),
      parsedData.balance,
      parsedData.date,
      parsedData.time,
      parsedData.location,
      parsedData.tag,
      parsedData.timestamp,
    ];

    await env.DB.prepare(query)
      .bind(...params)
      .run();
  } catch (error) {
    throw new Error(`Failed to save transaction to database: ${error.message}`);
  }
}

async function generateTransactionReport(
  env: Env,
  chatId: number,
  tag?: string,
  location?: string
): Promise<TransactionReport> {
  try {
    const schemaCheck = await env.DB.prepare(`
      PRAGMA table_info(transactions);
    `).all();
    
    const hasChatIdColumn = schemaCheck.results.some((column: any) => column.name === 'chat_id');
    if (!hasChatIdColumn) {
      throw new Error('Database schema is outdated: transactions table is missing chat_id column');
    }

    let query = `SELECT * FROM transactions WHERE chat_id = ?`;
    const params: any[] = [chatId];

    if (tag) {
      query += ` AND tag = ?`;
      params.push(tag);
    }
    if (location) {
      query += ` AND location = ?`;
      params.push(location);
    }

    const result = await env.DB.prepare(query).bind(...params).all();
    let transactions: TransactionData[] = result.results as TransactionData[];

    // Handle NULL transaction_type by inferring from amounts
    const warnings: string[] = [];
    transactions = transactions.map(tx => {
      if (!tx.transaction_type) {
        if (tx.withdrawal_amount != null && tx.deposit_amount == null) {
          warnings.push(`Transaction at ${tx.date} ${tx.time} has NULL transaction_type; assuming withdrawal`);
          return { ...tx, transaction_type: 'withdrawal' };
        } else if (tx.deposit_amount != null && tx.withdrawal_amount == null) {
          warnings.push(`Transaction at ${tx.date} ${tx.time} has NULL transaction_type; assuming deposit`);
          return { ...tx, transaction_type: 'deposit' };
        } else {
          warnings.push(`Transaction at ${tx.date} ${tx.time} has ambiguous transaction_type; skipping`);
          return tx;
        }
      }
      return tx;
    });

    if (warnings.length > 0) {
      await sendLogToTelegram(
        env,
        chatId,
        `⚠️ هشدار: برخی تراکنش‌ها دارای transaction_type نامعتبر هستند:\n${warnings.join('\n')}`,
        'error'
      );
    }

    // Sort transactions by date and time (descending)
    transactions.sort((a, b) => {
      const dateA = `${a.date} ${a.time}`;
      const dateB = `${b.date} ${b.time}`;
      return dateB.localeCompare(dateA);
    });

    const report: TransactionReport = {
      totalAmount: 0,
      totalWithdrawal: 0,
      totalDeposit: 0,
      transactionCount: transactions.length,
      transactions,
      byTag: {},
      byLocation: {},
    };

    for (const tx of transactions) {
      if (tx.transaction_type === 'withdrawal' && tx.withdrawal_amount != null) {
        report.totalWithdrawal += tx.withdrawal_amount;
        report.totalAmount -= tx.withdrawal_amount;
      } else if (tx.transaction_type === 'deposit' && tx.deposit_amount != null) {
        report.totalDeposit += tx.deposit_amount;
        report.totalAmount += tx.deposit_amount;
      }

      const tagKey = tx.tag || 'No Tag';
      if (!report.byTag[tagKey]) {
        report.byTag[tagKey] = { count: 0, totalWithdrawal: 0, totalDeposit: 0 };
      }
      report.byTag[tagKey].count += 1;
      if (tx.transaction_type === 'withdrawal' && tx.withdrawal_amount != null) {
        report.byTag[tagKey].totalWithdrawal += tx.withdrawal_amount;
      } else if (tx.transaction_type === 'deposit' && tx.deposit_amount != null) {
        report.byTag[tagKey].totalDeposit += tx.deposit_amount;
      }

      const locKey = tx.location || 'No Location';
      if (!report.byLocation[locKey]) {
        report.byLocation[locKey] = { 
          count: 0, 
          totalWithdrawal: 0, 
          totalDeposit: 0, 
          deposits: [], 
          withdrawals: [] 
        };
      }
      report.byLocation[locKey].count += 1;
      if (tx.transaction_type === 'withdrawal' && tx.withdrawal_amount != null) {
        report.byLocation[locKey].totalWithdrawal += tx.withdrawal_amount;
        report.byLocation[locKey].withdrawals.push(tx);
      } else if (tx.transaction_type === 'deposit' && tx.deposit_amount != null) {
        report.byLocation[locKey].totalDeposit += tx.deposit_amount;
        report.byLocation[locKey].deposits.push(tx);
      }
    }

    return report;
  } catch (error) {
    await sendLogToTelegram(
      env,
      chatId,
      `❌ خطا در تولید گزارش: ${error.message}`,
      'error'
    );
    throw new Error('Failed to generate report');
  }
}

function parseCommandParams(params: string): { tag?: string; location?: string } {
  const filters: { tag?: string; location?: string } = {};
  const paramPairs = params.split(/\s+/).filter(p => p.includes('='));
  for (const pair of paramPairs) {
    const [key, value] = pair.split('=');
    if (key.toLowerCase() === 'tag') {
      filters.tag = value;
    } else if (key.toLowerCase() === 'location') {
      filters.location = value;
    }
  }
  return filters;
}

function formatReport(report: TransactionReport): string {
  let message = `📊 گزارش جامع تراکنش‌ها\n`;
  message += `═══════════════════════\n`;

  // Summary Section
  message += `📋 خلاصه کلی:\n`;
  message += `🔢 تعداد تراکنش‌ها: ${report.transactionCount.toLocaleString('fa-IR')}\n`;
  message += `💸 مجموع برداشت: ${report.totalWithdrawal.toLocaleString('fa-IR')} ریال\n`;
  message += `💰 مجموع واریز: ${report.totalDeposit.toLocaleString('fa-IR')} ریال\n`;
  message += `📈 اثر خالص: ${report.totalAmount.toLocaleString('fa-IR')} ریال\n`;
  message += `═══════════════════════\n`;

  // Location Breakdown
  message += `📍 جزئیات تراکنش‌ها بر اساس مکان:\n`;
  if (Object.keys(report.byLocation).length === 0) {
    message += `⚠️ هیچ تراکنشی یافت نشد.\n`;
  } else {
    for (const [loc, data] of Object.entries(report.byLocation)) {
      message += `\n🏬 مکان: ${loc}\n`;
      message += `🔢 تعداد تراکنش‌ها: ${data.count.toLocaleString('fa-IR')}\n`;
      message += `💸 مجموع برداشت: ${data.totalWithdrawal.toLocaleString('fa-IR')} ریال\n`;
      message += `💰 مجموع واریز: ${data.totalDeposit.toLocaleString('fa-IR')} ریال\n`;

      // Deposits
      if (data.deposits.length > 0) {
        message += `\n  📥 واریز‌ها:\n`;
        const maxDisplay = Math.min(data.deposits.length, 5);
        for (let i = 0; i < maxDisplay; i++) {
          const tx = data.deposits[i];
          message += `  - ${tx.date} ${tx.time}: ${tx.deposit_amount?.toLocaleString('fa-IR')} ریال (\\#${tx.tag || 'بدون تگ'})\n`;
        }
        if (data.deposits.length > maxDisplay) {
          message += `  و ${data.deposits.length - maxDisplay} واریز دیگر...\n`;
        }
      }

      // Withdrawals
      if (data.withdrawals.length > 0) {
        message += `\n  📤 برداشت‌ها:\n`;
        const maxDisplay = Math.min(data.withdrawals.length, 5);
        for (let i = 0; i < maxDisplay; i++) {
          const tx = data.withdrawals[i];
          message += `  - ${tx.date} ${tx.time}: ${tx.withdrawal_amount?.toLocaleString('fa-IR')} ریال (\\#${tx.tag || 'بدون تگ'})\n`;
        }
        if (data.withdrawals.length > maxDisplay) {
          message += `  و ${data.withdrawals.length - maxDisplay} برداشت دیگر...\n`;
        }
      }
      message += `───────────────────\n`;
    }
  }

  // Tag Breakdown
  message += `\n📑 تفکیک بر اساس تگ:\n`;
  if (Object.keys(report.byTag).length === 0) {
    message += `⚠️ هیچ تگی یافت نشد.\n`;
  } else {
    for (const [tag, data] of Object.entries(report.byTag)) {
      message += `- ${tag}: ${data.count.toLocaleString('fa-IR')} تراکنش، ` +
        `برداشت: ${data.totalWithdrawal.toLocaleString('fa-IR')} ریال، ` +
        `واریز: ${data.totalDeposit.toLocaleString('fa-IR')} ریال\n`;
    }
  }

  message += `═══════════════════════\n`;
  return message;
}