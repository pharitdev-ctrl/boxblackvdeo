import { configure } from "@testing-library/react"

// Testing Library waits a second for a `findBy` or a `waitFor` unless told otherwise. The first run after the
// machine has stood idle can take longer than that to draw a page, so every renderer test waits up to five:
// a test that passes ends as soon as what it waits for is there, and one that fails still says so.
configure({ asyncUtilTimeout: 5000 })
