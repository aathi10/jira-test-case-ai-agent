import 'dotenv/config';
async function main() {
  const creds = Buffer.from(`${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`).toString('base64');
  const r = await fetch('https://ibm-middleware.atlassian.net/rest/api/3/myself', {
    headers: { Authorization: `Basic ${creds}`, Accept: 'application/json' },
  });
  const d = await r.json() as { accountId: string; displayName: string };
  console.log('accountId:', d.accountId);
  console.log('display  :', d.displayName);
}
main();
