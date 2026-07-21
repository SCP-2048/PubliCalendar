const base =
  "https://publicalendar-d6g6uxmuz4b418883-1454834210.ap-shanghai.app.tcloudbase.com";

async function req(method, path, { body, token } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${JSON.stringify(data)}`);
  }
  return data;
}

const created = await req("POST", "/api/schedules", {
  body: {
    name: "Delete Flow Verify",
    timeZone: "Asia/Shanghai",
    dateRanges: [{ startDate: "2026-09-10", endDate: "2026-09-11" }],
  },
});
const code = created.schedule.code;
const creatorToken = created.creatorToken;
console.log("created", code, "allow", created.schedule.allowParticipantsDeleteOthers);

const join = await req("POST", `/api/schedules/${code}/participants`, {
  body: { nickname: "Alice" },
});
console.log("joined", join.participant.id);

const beforeSubmit = await req("GET", `/api/schedules/${code}`);
console.log("hidden while unsubmitted", beforeSubmit.participants.length === 0);

await req("DELETE", `/api/schedules/${code}/participants/${join.participant.id}`, {
  token: join.participantToken,
});
console.log("self-deleted unsubmitted");

const join2 = await req("POST", `/api/schedules/${code}/participants`, {
  body: { nickname: "Bob" },
});
const start = Date.parse("2026-09-10T02:00:00Z");
await req("PUT", `/api/schedules/${code}/availability`, {
  token: join2.participantToken,
  body: { ranges: [{ start, end: start + 3_600_000 }] },
});
const afterSubmit = await req("GET", `/api/schedules/${code}`);
console.log("visible after submit", afterSubmit.participants.map((p) => p.nickname));

const patched = await req("PATCH", `/api/schedules/${code}`, {
  token: creatorToken,
  body: { allowParticipantsDeleteOthers: true },
});
console.log("patched allow", patched.allowParticipantsDeleteOthers);

const intersection = await req("GET", `/api/schedules/${code}/intersection`);
console.log("intersection", {
  complete: intersection.complete,
  submittedCount: intersection.submittedCount,
  ranges: intersection.ranges.length,
});

await req("DELETE", `/api/schedules/${code}/participants/${join2.participant.id}`, {
  token: creatorToken,
});
const afterDelete = await req("GET", `/api/schedules/${code}`);
console.log("creator deleted", afterDelete.participants.length === 0);
console.log("OK");
