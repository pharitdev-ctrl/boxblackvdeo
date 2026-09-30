/** Thai text as it is drawn: "ำ" written as one character, not nikhahit + sara aa. */
export const composeThai = (text: string): string => text.normalize("NFC").replaceAll("ํา", "ำ")

/** `composeThai`, with whitespace stripped: what two answers of the same word compare equal as. */
export const comparable = (text: string): string => composeThai(text).replace(/\s+/g, "")
