const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST, // smtp.gmail.com
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // true only for 465
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },

  // ✅ Prevent "pending forever" on Render / SMTP block
  connectionTimeout: 10_000, // 10s
  greetingTimeout: 10_000,   // 10s
  socketTimeout: 15_000,     // 15s
});

// ✅ Optional but very helpful: verify SMTP at startup (debug)
transporter.verify((err) => {
  if (err) {
    console.error("❌ SMTP Verify Failed:", err.message);
  } else {
    console.log("✅ SMTP Server is ready to send emails");
  }
});

async function sendMail({ to, subject, html }) {
  return transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
  });
}

module.exports = { sendMail };
