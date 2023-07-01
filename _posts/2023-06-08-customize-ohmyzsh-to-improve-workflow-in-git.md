---
layout: post
title: "Customize ohmyzsh to improve workflow in git"
date: 2023-06-08 1:11:36 +0545
categories: linux git zsh ohmyzsh
---

## Instruction
To use this customization, you can follow these steps:

1. Open your terminal and navigate to your home directory by running `cd ~`.
2. Open the `.zshrc` file in a text editor. If the file doesn't exist, you can create it by running `touch .zshrc`.
3. Copy and paste the above code into the `.zshrc` file.
4. Save the changes and close the file.
5. To apply the changes, either restart your terminal or run `source ~/.zshrc`.


To customize the `.zshrc` file to include aliases and functions for Oh My Zsh:

## .zshrc snippet
```bash
# Aliases
alias gs='gst'
alias gps='ggp'
alias gl="git log --graph --pretty='%Cred%h%Creset -%C(auto)%d%Creset %s %Cgreen(%ar) %C(bold blue)<%an>%Creset'"
alias gpl='ggpull'
alias runserver='python manage.py runserver'
alias migrate='python manage.py migrate'
alias createsuperuser='python manage.py createsuperuser'

# Function
function gcaa() {
    echo "Your commit message: "
    read message
    git commit -m "$message"
}
```

## Conclusion
After completing these steps, you should be able to use the defined aliases and function in your Zsh shell. For example, you can run `gs` instead of `gst` to execute the `git status` command. The `gcaa` function allows you to enter a custom commit message when committing changes to a Git repository.

Feel free to modify the aliases and function according to your preferences and requirements.