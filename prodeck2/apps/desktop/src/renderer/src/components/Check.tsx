/** A green tick before a short piece of good news. */
export function Check({ text }: { text: string }) {
  return (
    <span className="ok">
      <span aria-hidden>✓ </span>
      <span>{text}</span>
    </span>
  )
}
