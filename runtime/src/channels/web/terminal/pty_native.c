/*
 * pty_native.c — Minimal macOS PTY addon for Bun/Node.
 *
 * Exports three functions via a shared library (.dylib):
 *   pty_open(rows, cols) → { masterFd, slaveFd }
 *   pty_fork_exec_simple(slaveFd, shell) → childPid
 *   pty_resize(masterFd, rows, cols) → 0 on success
 *
 * pty_fork_exec_simple does the critical fork() → setsid() → TIOCSCTTY → exec()
 * in the fork-exec gap, which is required for SIGWINCH delivery to setuid
 * programs on macOS.
 *
 * Compile: cc -shared -o pty_native.dylib pty_native.c
 */
#include <sys/ioctl.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <util.h>

/* Result struct for pty_open — caller reads masterFd and slaveFd. */
struct pty_pair {
    int master_fd;
    int slave_fd;
};

/*
 * Create a PTY pair with the given initial size.
 * Returns 0 on success, -1 on failure.
 */
int pty_open(struct pty_pair *out, int rows, int cols) {
    struct winsize ws = { .ws_row = rows, .ws_col = cols };
    int master, slave;
    if (openpty(&master, &slave, NULL, NULL, &ws) < 0)
        return -1;
    /* O_CLOEXEC on master — child must not inherit after exec */
    fcntl(master, F_SETFD, FD_CLOEXEC);
    out->master_fd = master;
    out->slave_fd = slave;
    return 0;
}

/*
 * Resize the PTY. Returns 0 on success.
 */
int pty_resize(int master_fd, int rows, int cols) {
    struct winsize ws = { .ws_row = rows, .ws_col = cols };
    return ioctl(master_fd, TIOCSWINSZ, &ws);
}

/*
 * Fork+exec with shell path as a simple string.
 * Calls fork() directly in the calling process (Bun).
 * The child calls only async-signal-safe functions before exec.
 */
pid_t pty_fork_exec_simple(int slave_fd, const char *shell) {
    pid_t pid = fork();
    if (pid < 0) return -1;

    if (pid == 0) {
        setsid();
        ioctl(slave_fd, TIOCSCTTY, 0);
        dup2(slave_fd, STDIN_FILENO);
        dup2(slave_fd, STDOUT_FILENO);
        dup2(slave_fd, STDERR_FILENO);
        if (slave_fd > STDERR_FILENO) close(slave_fd);

        int maxfd = (int)sysconf(_SC_OPEN_MAX);
        if (maxfd < 0) maxfd = 256;
        for (int fd = 3; fd < maxfd; fd++) close(fd);

        /* Determine args based on shell */
        size_t slen = strlen(shell);
        int is_zsh = (slen >= 4 && strcmp(shell + slen - 4, "/zsh") == 0);
        if (is_zsh) {
            char *argv[] = {(char*)shell, "+o", "PROMPT_SP", "-i", NULL};
            execvp(shell, argv);
        } else {
            char *argv[] = {(char*)shell, "-i", NULL};
            execvp(shell, argv);
        }
        _exit(127);
    }

    return pid;
}
