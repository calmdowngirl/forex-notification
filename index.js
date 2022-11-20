const functions = require('@google-cloud/functions-framework')
const nodemailer = require("nodemailer")
const nf = require("node-fetch")
const Headers = nf.Headers
const secret = require('./secret.json')

const geThan = {
  CNY: 4.8,
  USD: 0.68,
}
const apiConvert = 'https://api.apilayer.com/currency_data/convert?'
const apiTimeSeries = 'https://api.apilayer.com/exchangerates_data/timeseries?'

async function fetchAll(endpoint) {
  const rates = {}

  const h = new Headers();
  h.append("apikey", secret.apikey);
  const response = await nf(endpoint, {
    method: "GET",
    headers: h,
  });
  if (response.ok) {
    const allSymbols = Object.keys(geThan)
    const r = await response.json()
    for (const key in r.rates) {
      if (Object.hasOwnProperty.call(r.rates, key)) {
        allSymbols.forEach(el => {
          if (r.rates[key][el]) {
            if (rates[el]) {
              rates[el].push(r.rates[key][el])
            } else {
              rates[el] = [r.rates[key][el]]
            }
          }
        })
      }
    }
  }

  console.log(rates)
  return rates
}

function getSymbolRate(rates, symbol) {
  return rates[symbol]
}

async function notifyRateGe(rate, up3, down3, compareTo) {
  let text = `Current AUD to ${compareTo || 'CNY'} Exchange Rate is 1:${rate}`
  if (up3) text = `AUD has been up for 3 consecutive days, current rate is ${rate}`
  if (down3) text = `AUD has been down for 3 consecutive days, current rate is ${rate}`

  const transporter = nodemailer.createTransport({
    host: "smtp-mail.outlook.com",
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: secret.from,
      pass: secret.password
    },
  });

  await transporter.sendMail({
    from: `"👻" <${secret.from}>`, // sender address
    to: secret.to, // list of receivers
    subject: `💲AUD to ${compareTo} Exchange Rate is 1:${rate}`, // Subject line
    text: text,
  });
}

functions.cloudEvent('audExPubSub', async cloudEvent => {
  const base64data = cloudEvent.data.message.data
  const data = base64data ?
    JSON.parse(Buffer.from(base64data, 'base64').toString()) : {}
  console.log(data)
  const from = data?.from || 'AUD'
  const to = data?.to || 'CNY,USD'
  const oneDay = 3600 * 1000 * 24
  const now = Date.now()
  const today = new Date(now).toISOString().split('T')[0]
  const twoDaysBefore = new Date(now - oneDay * 2).toISOString().split('T')[0]
  const timeseries = `${apiTimeSeries}start_date=${twoDaysBefore}&end_date=${today}&base=${from}&symbols=${to}`
  const allRates = await fetchAll(timeseries)
  const symbols = to.split(',')
  async function* asyncGenerator() {
    let i = 0;
    while (i < symbols.length) {
      yield symbols[i++]
    }
  }
  for await (const symbol of asyncGenerator()) {
    if (geThan[symbol] != null) {
      const rates = getSymbolRate(allRates, symbol)
      console.log(rates, symbol)
      const flag = {
        up3: false,
        down3: false,
      }
      const len = rates.length
      if (rates[0] < rates[1] && rates[1] < rates[2]) flag.up3 = true
      if (rates[2] < rates[1] && rates[1] < rates[0]) flag.down3 = true
      if (len) {
        console.log(JSON.stringify(flag))
        if (rates[len - 1] >= geThan[symbol] || flag.up3 || flag.down3) {
          await notifyRateGe(rates[len - 1], flag.up3, flag.down3, symbol)
          console.log("Email sent")
        }
      }
    }
  }
});
