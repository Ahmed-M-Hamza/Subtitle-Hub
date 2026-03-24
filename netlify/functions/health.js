import { getHealth, json } from "./_shared.js";

export async function handler() {
  return json(200, getHealth());
}

