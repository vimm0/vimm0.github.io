---
layout: post
title: "Learning Vim Commands"
date: 2022-02-15 10:45:36 +0545
categories: linux unix vi
---

### Vim

Vim - is Vi Improved editor for programmers.


| The Ultimate Vim Cheat Sheet: Boost Your Productivity with Vim |

Vim is a powerful and popular text editor known for its efficiency, speed, and extensive customization options. Whether you're a seasoned Vim user or just starting your journey with this versatile editor, having a cheat sheet handy can greatly enhance your productivity. In this blog post, we present the ultimate Vim cheat sheet that will help you navigate Vim's vast array of commands and features.

## Vim Modes

| Mode              | Description                                       |
|-------------------|---------------------------------------------------|
| Normal Mode       | The default mode for navigating and executing commands. |
| Insert Mode       | Used for inserting and editing text.              |
| Visual Mode       | Allows selecting and manipulating blocks of text. |
| Command-Line Mode | Enables entering commands and searching.          |

## Basic Movements

| Command | Description                                     |
|---------|-------------------------------------------------|
| h/j/k/l | Move left/down/up/right.                        |
| 0       | Move to the beginning of the line.               |
| $       | Move to the end of the line.                     |
| gg      | Move to the start of the file.                   |
| G       | Move to the end of the file.                     |
| w       | Move to the beginning of the next word.          |
| b       | Move to the beginning of the previous word.      |
| Ctrl+f  | Scroll forward one page.                         |
| Ctrl+b  | Scroll backward one page.                        |

## Editing and Manipulating Text

| Command | Description                                     |
|---------|-------------------------------------------------|
| i       | Enter Insert Mode at the cursor.                 |
| a       | Enter Insert Mode after the cursor.              |
| o       | Insert a new line below the current line.        |
| O       | Insert a new line above the current line.        |
| x       | Delete the character under the cursor.           |
| dd      | Delete the current line.                         |
| yy      | Yank (copy) the current line.                    |
| p       | Paste the yanked or deleted text.                |
| u       | Undo the last command.                           |
| Ctrl+r  | Redo the last undone command.                    |

## Searching and Replacing

| Command           | Description                                     |
|-------------------|-------------------------------------------------|
| /pattern          | Search forward for a pattern.                    |
| ?pattern          | Search backward for a pattern.                   |
| n                 | Move to the next occurrence of the search pattern. |
| N                 | Move to the previous occurrence of the search pattern. |
| :%s/old/new/g     | Replace all occurrences of "old" with "new" in the entire file. |
| :s/old/new/g      | Replace all occurrences of "old" with "new" in the current line. |
| :s/old/new/gc     | Replace with confirmation for each occurrence.   |

## Advanced Editing and Navigation

| Command    | Description                                     |
|------------|-------------------------------------------------|
| Ctrl+w     | Switch between Vim's split windows.              |
| :vsp filename | Open a new vertical split.                     |
| :sp filename  | Open a new horizontal split.                   |
| Ctrl+ww    | Cycle between open windows.                      |
| Ctrl+o     | Jump back to the previous cursor position.       |
| Ctrl+i     | Jump forward to the next cursor position.        |
| :set number | Display line numbers.                            |
| :set hlsearch | Highlight search results.                       |
| :set ignorecase | Perform case-insensitive searches.              |

## Customizing Vim

| Command    | Description                                     |
|------------|-------------------------------------------------
|
| .vimrc     | Create or modify the `.vimrc` file to define custom settings and mappings. |
| :map       | Create custom key mappings for frequently used commands. |
| :set       | Configure various options, such as colorscheme, tab width, and indentation. |
| :syntax    | Enable syntax highlighting for different programming languages. |
| :abbrev    | Create abbreviations for frequently used phrases. |

You could find other important vim commands from the command below:

```bash
# while editing file
:help
# to route between helpful commands that vim provides
# help ranges from tutorial to more deep vim specific
# manuals.

# shows manual page for vim and their arguments for 
# opening file
man vim

```

## Conclusion

This ultimate Vim cheat sheet covers a wide range of essential commands and shortcuts to enhance your productivity and efficiency while working with Vim. Remember, practice makes perfect, so don't hesitate to experiment and explore Vim's extensive features. By incorporating these commands into your daily workflow, you'll be well on your way to becoming a Vim power user.

Happy Vimming!

### Reference
- [Vim FAQs](https://vimhelp.org/vim_faq.txt.html)
