export function compareMessageRows(a, b) {
  const timeOrder = a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  if (timeOrder) return timeOrder;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function mergeMessageRows(existing, incoming) {
  const byId = new Map();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) {
    const previous = byId.get(message.id);
    if (!previous || messageVersion(message) >= messageVersion(previous)) {
      byId.set(message.id, message);
    }
  }
  return [...byId.values()].sort(compareMessageRows);
}

function messageVersion(message) {
  return Math.max(
    Date.parse(message.created_at) || 0,
    Date.parse(message.edited_at || "") || 0,
    Date.parse(message.deleted_at || "") || 0
  );
}

export function latestMessageCursor(messages) {
  return messages.reduce((latest, message) => {
    if (!latest || compareMessageRows(message, latest) > 0) {
      return { created_at: message.created_at, id: message.id };
    }
    return latest;
  }, null);
}
