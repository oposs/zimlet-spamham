# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
except that the first subsection is called `New` rather than `Added`. The release
workflow matches on `### New`; renaming it silently drops the section from the
release notes.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### New

### Changed

- The Modern zimlet builds with pnpm instead of npm, and CI runs it
  through repo-infra's `ri-ci-node-pnpm` piece. The package is unchanged.

### Fixed

## 0.10.0 - 2026-11-26

### Changed

- `reportAddress` and `reportTeam` are empty by default. After the upgrade,
  set them with `zmzimletctl configure`, because the new configuration
  template replaces the stored configuration on deploy. Until then the
  action shows an error and sends nothing.

## 0.9.0 - 2026-11-23
### Changed
- The report subject names direction and content:
  `[SPAM Report Full] <server> <account>`, `[SPAM Report Header] …`,
  `[HAM Report Full] …` or `[HAM Report Header] …` (was
  `[ZHR] SPAM|HAM Report …`). Filters on the old `[ZHR]` subject need an
  update.

## 0.8.0 - 2026-11-20
### New
- `reportByDomain` sets the report address and the team name per mail
  domain of the account: one line `<domain> <address> [team name]` per
  domain. Config templates 0.1.9 (Classic) and 0.1.2 (Modern).
- Releases on GitHub carry both zimlet packages.

### Fixed
- The Classic zimlet now reads `reportTeam`; it always showed the default
  team name before.
