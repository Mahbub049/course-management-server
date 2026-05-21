// server/src/utils/mailer.js

const sendMail = async ({ to, subject, html, text }) => {
  if (!process.env.BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY is missing.");
  }

  const senderName = process.env.MAIL_FROM_NAME || "BUBT Course Portal";
  const senderEmail = process.env.MAIL_FROM_EMAIL || "bubtcourses@gmail.com";

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": process.env.BREVO_API_KEY,
      },
      body: JSON.stringify({
        sender: {
          name: senderName,
          email: senderEmail,
        },
        to: [
          {
            email: to,
          },
        ],
        subject,
        htmlContent: html,
        textContent: text || undefined,
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("BREVO EMAIL SEND ERROR:", {
        status: response.status,
        data,
      });

      throw new Error(
        data?.message ||
          data?.code ||
          "Failed to send email through Brevo."
      );
    }

    return data;
  } catch (error) {
    console.error("BREVO EMAIL SEND ERROR:", {
      message: error.message,
    });

    throw error;
  }
};

module.exports = {
  sendMail,
};