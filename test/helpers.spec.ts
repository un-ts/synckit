import {
  IMPORT_FLAG,
  LOADER_FLAG,
  REQUIRE_ABBR_FLAG,
  REQUIRE_FLAG,
  hasImportFlag,
  hasLoaderFlag,
  hasRequireFlag,
} from 'synckit'

describe('helpers', () => {
  describe('flag detection utilities', () => {
    test('hasRequireFlag', () => {
      // Should return true when --require flag is present
      expect(hasRequireFlag([REQUIRE_FLAG, 'some-module'])).toBe(true)

      // Should return true when -r shorthand flag is present
      expect(hasRequireFlag([REQUIRE_ABBR_FLAG, 'some-module'])).toBe(true)

      // Should return true when flag is in the middle of array
      expect(
        hasRequireFlag(['--other-flag', REQUIRE_FLAG, 'some-module']),
      ).toBe(true)

      // Should return false when flag is not present
      expect(hasRequireFlag(['--other-flag'])).toBe(false)

      // Should return false for empty array
      expect(hasRequireFlag([])).toBe(false)
    })

    test('hasImportFlag', () => {
      // Should return true when --import flag is present
      expect(hasImportFlag([IMPORT_FLAG, 'some-module'])).toBe(true)

      // Should return true when flag is in the middle of array
      expect(hasImportFlag(['--other-flag', IMPORT_FLAG, 'some-module'])).toBe(
        true,
      )

      // Should return false when flag is not present
      expect(hasImportFlag(['--other-flag'])).toBe(false)

      // Should return false for empty array
      expect(hasImportFlag([])).toBe(false)
    })

    test('hasLoaderFlag', () => {
      // Should return true when --loader flag is present
      expect(hasLoaderFlag([LOADER_FLAG, 'some-loader'])).toBe(true)

      // Should return true when flag is in the middle of array
      expect(hasLoaderFlag(['--other-flag', LOADER_FLAG, 'some-module'])).toBe(
        true,
      )

      // Should return false when flag is not present
      expect(hasLoaderFlag(['--other-flag'])).toBe(false)

      // Should return false for empty array
      expect(hasLoaderFlag([])).toBe(false)
    })
  })
})
