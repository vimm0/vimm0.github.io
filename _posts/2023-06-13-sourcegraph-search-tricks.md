---
layout: post
title: "Sourcegraph Search Tricks for Open Source Contributors and Maintainers"
date: 2023-06-11 11:00:36 +0545
categories: sourcegraph git
---

As an open source contributor or maintainer, efficiently navigating and exploring large codebases can be a challenging task. [Sourcegraph](https://about.sourcegraph.com/), a powerful code search and intelligence tool, can significantly enhance your productivity by helping you discover code patterns, explore dependencies, and identify relevant code locations quickly. In this article, we'll explore several Sourcegraph search tricks that can benefit open source contributors and maintainers. Let's dive in!

## Searching for Code Patterns

Sourcegraph allows you to search for specific code patterns using regular expressions. Here are a few tricks to make your code searches more effective:

- Use `regexp:` prefix before your search query to enable regular expression matching.
  - [`regexp:console.(log|warn)`](https://sourcegraph.com/search?q=regexp%3Aconsole.(log%7Cwarn))
- Utilize regex character classes like `[a-z]`, `[0-9]`, and `[^ ]` to match specific character ranges or exclude certain characters.
- Leverage anchors like `^` (start of line) and `$` (end of line) to search for code at specific locations.
 
## Searching for Repositories

To narrow down your search to specific repositories, you can use repository filters. Here are a couple of useful tips:

- Use the `repo:` keyword followed by the repository name or a pattern to search within a particular repository.
  - [`repo:github.com/example/repo`](https://sourcegraph.com/search?q=repo%3Agithub.com%2Fexample%2Frepo)
- Employ the `repogroup:` keyword followed by the group name to search within a specific group of repositories.

## Searching for File Names and Extensions

When you are interested in searching for specific file names or extensions, Sourcegraph provides the following features:

- Use the `file:` keyword followed by the file name or pattern to search for files matching the specified name.
   - [`file:app.js`](https://sourcegraph.com/search?q=file%3Aapp.js)
- Utilize the `lang:` keyword followed by the language name to search for files of a specific programming language.

## Searching for Function or Method Definitions

To locate function or method definitions, you can employ the following techniques:

- Use the `func:` or `method:` keywords followed by the function or method name to search for its definition.
   - [`func:calculateTotal`](https://sourcegraph.com/search?q=func%3AcalculateTotal)
- Combine it with the `file:` keyword to search for function definitions within specific files.

## Searching for Usage Examples

If you're looking for code snippets or usage examples, Sourcegraph can help with that too:

- Use the `example:` keyword followed by the code snippet to find usage examples of a particular code pattern.
   - [`example:fetch API`](https://sourcegraph.com/search?q=example%3Afetch+API)
- Combine it with the `repo:` keyword to search for examples within specific repositories.

## Searching for Dependencies

Understanding a project's dependencies is crucial for open source contributors. Sourcegraph enables you to search for dependencies using the following tips:

- Use the `imports:` keyword followed by the package name to find the code locations where a specific package is imported.
   - [`imports:axios`](https://sourcegraph.com/search?q=imports%3Aaxios)
- Combine it with the `repo:` keyword to search for dependencies within specific repositories.

## Searching for Code Comments and Documentation

To explore code comments and documentation, utilize the following techniques:

- Use the `content:` keyword followed by your search query to search for comments and documentation containing specific text.
   - [`content:TODO`](https://sourcegraph.com/search?q=content%3ATODO)
- Combine it with the `repo:` keyword to limit your search to specific repositories.

## Searching for Code Authors

If you want to find code contributed by a particular author, Sourcegraph offers the following options:

- Use the `author:` keyword followed by the author's username to search for code written by a specific person.
   - [`author:john.doe`](https://sourcegraph.com/search?q=author%3Ajohn.doe)
- Combine it with other search keywords to narrow down your search further.

## Searching for Code Changes

To track code changes within a repository or a specific file, you can utilize these techniques:

- Use the `type:diff` keyword followed by your search query to search for code changes that match the provided pattern.
   - [`type:diff bug fix`](https://sourcegraph.com/search?q=type%3Adiff+bug+fix)
- Combine it with other search keywords like `repo:` or `file:` to limit your search scope.

## Searching for Code with Annotations

Sourcegraph provides a feature called "code annotations" that allows developers to add comments and notes to specific lines of code. Here's how you can search for annotated code:

- Use the `patternType:regexp` keyword followed by the annotation pattern to search for code with specific annotations.
    - [`patternType:regexp "// TODO:"`](https://sourcegraph.com/search?q=patternType%3Aregexp+%22%2F%2F+TODO%3A%22)
- Combine it with other search keywords to narrow down your search to specific repositories or files.

## Some examples
- Find projects that welcome contributions
  - [`contributing lang:Markdown`](https://sourcegraph.com/search?q=context:global+contributing+lang:Markdown+&patternType=literal)
  - [`hacktoberfest lang:Markdown`](https://sourcegraph.com/search?q=context:global+hacktoberfest+lang:Markdown+&patternType=literal)

- Find Hacktoberfest-friendly projects using a certain language or framework
  - [`hacktoberfest lang:Markdown repohasfile:"^composer.json$" patterntype:regexp`](https://sourcegraph.com/search?q=context:global+hacktoberfest+lang:Markdown+repohasfile:%22%5Ecomposer.json%24%22&patternType=regexp)
  - [`hacktoberfest lang:Markdown repohasfile:"^artisan$" patterntype:regexp`](https://sourcegraph.com/search?q=context:global+hacktoberfest+lang:Markdown+repohasfile:%22artisan%22&patternType=regexp)

- Find projects that rely on specific dependencies
  - [`tailwindcss file:package.json`](https://sourcegraph.com/search?q=context:global+file:package.json+tailwindcss&patternType=literal)
  - [`file:package.json tailwindcss repohasfile:"composer.json" patterntype:regexp`](https://sourcegraph.com/search?q=context:global+file:package.json+tailwindcss+repohasfile:%22composer.json%22&patternType=regexp)

- Find how an object is used across multiple repositories
  - [`repo:^github\.com/minicli/.* new TableHelper lang:PHP`](https://sourcegraph.com/search?q=context:global+repo:%5Egithub%5C.com/minicli/.*+new+TableHelper+lang:PHP&patternType=literal)
  - [`repo:^github\.com/minicli/.* getPrinter()->out(...,...) patterntype:structural`](https://sourcegraph.com/search?q=context%3Aglobal+repo%3A%5Egithub%5C.com%2Fminicli%2F.*+getPrinter%28%29-%3Eout%28...%2C...%29&patternType=structural&groupBy=repo)

- Find keys and secrets that should not have been committed to the codebase
  - [`repo:^github\.com/sourcegraph/.* (key|secret|token)-[\w+]{32,} patterntype:regexp`](https://sourcegraph.com/search?q=context:global+repo:%5Egithub%5C.com/sourcegraph/.*+%28key%7Csecret%7Ctoken%29-%5B%5Cw%2B%5D%7B32%2C%7D&patternType=regexp)

- Find usage of compromised dependencies
  - [`symfont/process lang:JSON`](https://sourcegraph.com/search?q=context:global+symfont/process+lang:JSON+&patternType=literal)

- Audit an organization for outdated or vulnerable dependencies across repositories
  - [`file:package.json lodash 4.17.19 patterntype:regexp`](https://sourcegraph.com/search?q=context:global+file:package.json+lodash+4.17.19&patternType=regexp)

- Find code that is not up to language standards across multiple repositories
  - [`lang:PHP ^if([(...)]) patterntype:regexp`](https://sourcegraph.com/search?q=context:global+lang:PHP+%5Eif%28%5B%28...%29%5D%29&patternType=regexp)

- Search for recent changes in large or multiple projects
  - [`repo:^github\.com/laravel/laravel$ type:commit after:lastweek`](https://sourcegraph.com/search?q=context%3Aglobal+repo%3A%5Egithub%5C.com%2Flaravel%2Flaravel%24+type%3Acommit+after%3Alastweek&groupBy=author)
  - [`repo:^github\.com/laravel/.*  type:diff after:lastweek`](https://sourcegraph.com/search?q=context:global+repo:%5Egithub%5C.com/laravel/.*++type:diff+after:lastweek&patternType=literal)

- Find deprecated function calls among OSS projects in your language of choice
  - [`mhash(...) lang:PHP select:content patterntype:structural`](https://sourcegraph.com/search?q=context:global+mhash%28...%29+lang:PHP+select:content&patternType=structural)



## Conclusion

By mastering these search tricks, you can efficiently navigate codebases, find relevant code locations, track changes, and discover valuable insights. Incorporate these tips into your workflow, and watch your efficiency soar as you contribute to and maintain open source projects with ease. Happy searching!
