@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem NetsuBoard development launcher.
rem Double-click for the interactive menu, or use:
rem   run.bat --launch|--convex|--switch|--pull|--push|--status

set "ROOT=%~dp0"
set "LOCK_STAMP=%ROOT%node_modules\.netsuboard-package-lock.hash"
set "ENV_FILE=%ROOT%.env.local"
rem Sibling checkout of NetsuRush, used ONLY to recognise its Convex deployment and refuse it.
set "SIBLING_ENV=%ROOT%..\NetsuRush\.env.local"

cd /d "%ROOT%" || goto :fatal_root
title NetsuBoard - Development launcher

if /i "%~1"=="--launch" goto :launch
if /i "%~1"=="--convex" goto :convex_cli
if /i "%~1"=="--switch" goto :switch_cli
if /i "%~1"=="--pull" goto :pull_cli
if /i "%~1"=="--push" goto :push_cli
if /i "%~1"=="--status" goto :status_cli
if not "%~1"=="" (
  echo [ERROR] Unknown option: %~1
  echo Use: run.bat [--launch^|--convex^|--switch^|--pull^|--push^|--status]
  exit /b 2
)

call :require_command git Git
if errorlevel 1 goto :failed

:menu
cls
echo ============================================================
echo   NetsuBoard - Dev launcher
echo ============================================================
call :print_git_summary
call :print_convex_summary
echo.
echo   [1] Start NetsuBoard
echo   [2] Convex backend ^(create or start^)
echo   [3] Switch branch
echo   [4] Refresh branch list ^(fetch^)
echo   [5] Update current branch ^(safe pull^)
echo   [6] Send commits to GitHub ^(push^)
echo   [7] Show Git status
echo   [0] Exit
echo.
set "MENU_CHOICE="
set /p "MENU_CHOICE=Choose a number: "
if "%MENU_CHOICE%"=="1" goto :launch
if "%MENU_CHOICE%"=="2" goto :menu_convex
if "%MENU_CHOICE%"=="3" goto :menu_switch
if "%MENU_CHOICE%"=="4" goto :menu_fetch
if "%MENU_CHOICE%"=="5" goto :menu_pull
if "%MENU_CHOICE%"=="6" goto :menu_push
if "%MENU_CHOICE%"=="7" goto :menu_status
if "%MENU_CHOICE%"=="0" exit /b 0
goto :menu

:menu_convex
call :convex_setup
goto :menu_pause

:menu_switch
call :switch_branch
goto :menu_pause

:menu_fetch
call :fetch_refs
goto :menu_pause

:menu_pull
call :pull_branch
goto :menu_pause

:menu_push
call :push_branch
goto :menu_pause

:menu_status
git status
goto :menu_pause

:menu_pause
echo.
pause
goto :menu

:convex_cli
call :require_command npx npx
if errorlevel 1 goto :failed
call :convex_setup
exit /b %ERRORLEVEL%

:switch_cli
call :require_command git Git
if errorlevel 1 goto :failed
call :switch_branch
exit /b %ERRORLEVEL%

:pull_cli
call :require_command git Git
if errorlevel 1 goto :failed
call :pull_branch
exit /b %ERRORLEVEL%

:push_cli
call :require_command git Git
if errorlevel 1 goto :failed
call :push_branch
exit /b %ERRORLEVEL%

:status_cli
call :require_command git Git
if errorlevel 1 goto :failed
git status --short --branch
exit /b %ERRORLEVEL%

:launch
call :require_command node Node.js
if errorlevel 1 goto :failed
call :require_command npm npm
if errorlevel 1 goto :failed
rem Tauri needs the Rust toolchain. Without this check, `npm run tauri dev` fails inside its own
rem window while this one exits successfully: the app never opens and nothing says why.
call :require_command cargo Rust
if errorlevel 1 goto :failed
call :sync_dependencies
if errorlevel 1 goto :failed

rem Convex is OPTIONAL: with no deployment the app opens straight on the board, with no sign-in and
rem with bug reports falling back to the direct webhook. A WRONG deployment, on the other hand, is
rem never acceptable - it is the whole reason for the guard.
call :convex_guard
if defined CONVEX_FOREIGN (
  call :print_foreign_deployment
  goto :failed
)
if defined CONVEX_READY (
  call :find_convex_window
  if defined CONVEX_RUNNING (
    echo [INFO] Convex watcher already running.
  ) else (
    echo [INFO] Starting the Convex watcher ^(!CONVEX_DEPLOYMENT_VALUE!^)...
    start "NetsuBoard - Convex" cmd /k npx convex dev
  )
) else (
  echo [INFO] No Convex deployment: starting with no sign-in and no relay. Menu entry [2] sets it up.
)

rem No core port check here. The Tauri shell sweeps 8760-8779 for a FREE port at every spawn
rem (`pick_core_port`, src-tauri/src/lib.rs) and hands it to the renderer, so an occupied port is
rem not a failure and nothing has to be killed first.

call :find_listener 1430
if defined LISTENER_PID (
  echo [INFO] A server already uses the Vite port 1430 ^(PID !LISTENER_PID!^).
  call :show_process !LISTENER_PID!
  set "REUSE_VITE=y"
  set /p "REUSE_VITE=Use this server? (Y/n): "
  if /i "!REUSE_VITE!"=="n" (
    echo [ERROR] Stop the server on port 1430, then run this file again.
    goto :failed
  )
) else (
  rem `--force` re-optimizes the dependency cache from scratch. That is only needed when the
  rem packages just changed; doing it on every start pays a cold pre-bundle each time.
  rem Two waits, because the two cases are not comparable. A cold start pre-bundles every
  rem dependency and, on a slow disk, runs for minutes. A warm start reuses that cache and answers
  rem in seconds, so a long wait there would only hide a crashed server.
  set "VITE_WAIT=60"
  set "VITE_WAIT_LABEL=60 seconds"
  if defined DEPENDENCIES_INSTALLED (
    echo [INFO] Starting Vite ^(rebuilding the dependency cache, this first run is slow^)...
    start "NetsuBoard - Vite :1430" cmd /k npm run dev -- --force
    set "VITE_WAIT=900"
    set "VITE_WAIT_LABEL=15 minutes"
  ) else (
    echo [INFO] Starting Vite...
    start "NetsuBoard - Vite :1430" cmd /k npm run dev
  )
  echo [INFO] Waiting for Vite. Do not close this window.
  call :wait_for_http http://127.0.0.1:1430 !VITE_WAIT!
  if errorlevel 1 (
    echo [ERROR] Vite did not answer after !VITE_WAIT_LABEL!.
    echo Read the "NetsuBoard - Vite :1430" window: it is either still starting or it crashed.
    goto :failed
  )
  echo [OK] Vite is ready.
)

echo [INFO] Starting Tauri ^(app + core^)...
start "NetsuBoard - Tauri (app + core)" cmd /k npm run tauri dev
exit /b 0

rem ---------------------------------------------------------------------------
rem Convex
rem
rem This project was copied out of NetsuRush WITH its `.env.local`, which is git-ignored and
rem therefore invisible in `git status`. Running `npx convex dev` in that state pushed NetsuBoard's
rem schema onto NetsuRush's deployment and dropped the indexes of every table it does not declare.
rem Hence the guard below: the launcher refuses to touch a deployment that is not this project's.
rem ---------------------------------------------------------------------------

:convex_setup
call :require_command npx npx
if errorlevel 1 exit /b 1
call :convex_guard
if defined CONVEX_FOREIGN (
  call :print_foreign_deployment
  exit /b 1
)
if defined CONVEX_READY goto :convex_start_window

echo.
echo [INFO] No Convex deployment yet.
echo        "npx convex dev" runs in THIS window so you can answer its questions.
echo        Choose "create a new project" and name it netsuboard - never reuse netsurush.
echo        It keeps running and pushes convex\ on every change. Ctrl+C stops it.
echo.
set "CONFIRM_CONVEX="
set /p "CONFIRM_CONVEX=Start the Convex setup now? (y/N): "
if /i not "!CONFIRM_CONVEX!"=="y" exit /b 0
call npx convex dev
call :convex_env_checklist
exit /b 0

:convex_start_window
call :find_convex_window
if defined CONVEX_RUNNING (
  echo [INFO] Convex watcher already running ^(!CONVEX_DEPLOYMENT_VALUE!^).
  exit /b 0
)
echo [INFO] Starting the Convex watcher ^(!CONVEX_DEPLOYMENT_VALUE!^)...
start "NetsuBoard - Convex" cmd /k npx convex dev
exit /b 0

:convex_env_checklist
echo.
echo Still to do ONCE on the deployment - these are secrets, so type them yourself:
echo   npx convex env set SITE_URL "https://^<deployment^>.convex.site"
echo   npx convex env set BETTER_AUTH_SECRET "^<32+ random bytes, base64^>"
echo   npx convex env set DISCORD_CLIENT_ID "^<client id^>"
echo   npx convex env set DISCORD_CLIENT_SECRET "^<client secret^>"
echo   npx convex env set OPEN_BETA "true"
echo   npx convex env set BUG_WEBHOOK "^<Discord webhook URL^>"
echo.
echo Discord redirect to declare: https://^<deployment^>.convex.site/api/auth/callback/discord
echo Full walkthrough: docs\convex-setup.md
exit /b 0

:convex_guard
set "CONVEX_READY="
set "CONVEX_FOREIGN="
set "CONVEX_DEPLOYMENT_VALUE="
set "CONVEX_RAW_LINE="
call :read_env_file "%ENV_FILE%"
set "CONVEX_DEPLOYMENT_VALUE=!ENV_DEPLOYMENT!"
set "CONVEX_RAW_LINE=!ENV_RAW_DEPLOYMENT!"
if not defined CONVEX_DEPLOYMENT_VALUE exit /b 0
rem `npx convex dev` writes the deployment with a trailing comment naming team and project. When
rem that comment says netsurush, this file is the copied one, not ours.
echo(!CONVEX_RAW_LINE!|findstr /i "netsurush" >nul && set "CONVEX_FOREIGN=1"
rem Same deployment as the sibling checkout: same conclusion, with or without a comment.
if exist "%SIBLING_ENV%" (
  call :read_env_file "%SIBLING_ENV%"
  if /i "!ENV_DEPLOYMENT!"=="!CONVEX_DEPLOYMENT_VALUE!" set "CONVEX_FOREIGN=1"
)
if defined CONVEX_FOREIGN exit /b 0
set "CONVEX_READY=1"
exit /b 0

:print_convex_summary
call :convex_guard
if defined CONVEX_FOREIGN (
  echo   Convex: WRONG DEPLOYMENT in .env.local - fix it before option 1 or 2
  exit /b 0
)
if defined CONVEX_READY (
  echo   Convex: !CONVEX_DEPLOYMENT_VALUE!
) else (
  echo   Convex: not configured ^(optional - the app runs without it^)
)
exit /b 0

:print_foreign_deployment
echo.
echo [ERROR] .env.local points at a Convex deployment that is NOT NetsuBoard's:
echo           !CONVEX_RAW_LINE!
echo.
echo Pushing to it would replace that project's schema with NetsuBoard's and DROP the indexes of
echo every table this repository does not declare. This file arrived with the NetsuRush copy.
echo.
echo Fix: blank CONVEX_DEPLOYMENT, VITE_CONVEX_URL and VITE_CONVEX_SITE_URL in .env.local, then
echo use menu entry [2] to create the netsuboard project.
exit /b 0

:find_convex_window
set "CONVEX_RUNNING="
tasklist /fi "WINDOWTITLE eq NetsuBoard - Convex*" 2>nul | findstr /i "cmd.exe" >nul && set "CONVEX_RUNNING=1"
exit /b 0

:read_env_file
rem %1 = path to a .env file. Sets ENV_DEPLOYMENT / ENV_URL / ENV_SITE / ENV_RAW_DEPLOYMENT.
set "ENV_DEPLOYMENT="
set "ENV_URL="
set "ENV_SITE="
set "ENV_RAW_DEPLOYMENT="
if not exist "%~1" exit /b 0
for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%~1") do (
  if /i "%%A"=="CONVEX_DEPLOYMENT" (
    set "ENV_RAW_DEPLOYMENT=%%B"
    call :strip_env_value ENV_DEPLOYMENT "%%B"
  )
  if /i "%%A"=="VITE_CONVEX_URL" call :strip_env_value ENV_URL "%%B"
  if /i "%%A"=="VITE_CONVEX_SITE_URL" call :strip_env_value ENV_SITE "%%B"
)
exit /b 0

:strip_env_value
rem %1 = target variable, %2 = raw value. Cuts the trailing "# comment" and the surrounding spaces.
set "ENV_RAW=%~2"
if not defined ENV_RAW (
  set "%~1="
  exit /b 0
)
for /f "tokens=1 delims=#" %%V in ("!ENV_RAW!") do set "ENV_RAW=%%V"
:strip_env_lead
if not defined ENV_RAW goto :strip_env_done
if not "!ENV_RAW:~0,1!"==" " goto :strip_env_trail
set "ENV_RAW=!ENV_RAW:~1!"
goto :strip_env_lead
:strip_env_trail
if not defined ENV_RAW goto :strip_env_done
if not "!ENV_RAW:~-1!"==" " goto :strip_env_done
set "ENV_RAW=!ENV_RAW:~0,-1!"
goto :strip_env_trail
:strip_env_done
set "%~1=!ENV_RAW!"
exit /b 0

:switch_branch
call :fetch_refs
if errorlevel 1 (
  echo [WARNING] Fetch failed. Only known local branches will be shown.
)

set "CURRENT_BRANCH="
for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%B"
echo.
echo Current branch: !CURRENT_BRANCH!
echo.

set /a BRANCH_COUNT=0
for /f "delims=" %%B in ('git for-each-ref --format^="%%(refname:short)" refs/heads refs/remotes/origin 2^>nul') do (
  if /i not "%%B"=="origin" if /i not "%%B"=="origin/HEAD" (
    set /a BRANCH_COUNT+=1
    set "BRANCH_!BRANCH_COUNT!=%%B"
    if /i "%%B"=="!CURRENT_BRANCH!" (
      echo   [!BRANCH_COUNT!] %%B ^(active^)
    ) else (
      echo   [!BRANCH_COUNT!] %%B
    )
  )
)
if !BRANCH_COUNT! EQU 0 (
  echo [ERROR] No branch found.
  exit /b 1
)

echo   [0] Cancel
echo.
set "BRANCH_CHOICE="
set /p "BRANCH_CHOICE=Choose a number: "
if "!BRANCH_CHOICE!"=="0" exit /b 0
echo(!BRANCH_CHOICE!| findstr /r /x "[0-9][0-9]*" >nul || (
  echo [ERROR] Invalid choice.
  exit /b 1
)
if !BRANCH_CHOICE! LSS 1 (
  echo [ERROR] Invalid choice.
  exit /b 1
)
if !BRANCH_CHOICE! GTR !BRANCH_COUNT! (
  echo [ERROR] Invalid choice.
  exit /b 1
)
call set "TARGET_BRANCH=%%BRANCH_!BRANCH_CHOICE!%%"
if /i "!TARGET_BRANCH!"=="!CURRENT_BRANCH!" (
  echo [INFO] This branch is already active.
  exit /b 0
)

call :has_worktree_changes
if not errorlevel 1 (
  echo.
  echo [WARNING] You have files that are not committed.
  echo Git will keep safe changes. It will stop if there is a conflict.
  echo This launcher will NOT create a stash automatically.
  set "CONFIRM_SWITCH="
  set /p "CONFIRM_SWITCH=Continue? (y/N): "
  if /i not "!CONFIRM_SWITCH!"=="y" exit /b 1
)

if /i "!TARGET_BRANCH:~0,7!"=="origin/" (
  set "LOCAL_TARGET=!TARGET_BRANCH:~7!"
  git show-ref --verify --quiet "refs/heads/!LOCAL_TARGET!"
  if errorlevel 1 (
    git switch --track "!TARGET_BRANCH!"
  ) else (
    git switch "!LOCAL_TARGET!"
  )
) else (
  git switch "!TARGET_BRANCH!"
)
if errorlevel 1 (
  echo [ERROR] Git could not switch branch. Your files were NOT hidden in a stash.
  exit /b 1
)
echo [OK] Current branch:
git branch --show-current
exit /b 0

:fetch_refs
echo [INFO] Refreshing Git branches...
git fetch origin --prune
if errorlevel 1 (
  echo [ERROR] Fetch failed. Check your internet and GitHub access.
  exit /b 1
)
echo [OK] Branch list refreshed.
exit /b 0

:pull_branch
call :current_branch_or_fail
if errorlevel 1 exit /b 1
call :has_upstream
if errorlevel 1 (
  echo [ERROR] Branch !CURRENT_BRANCH! is not linked to GitHub yet.
  echo Use the push option first.
  exit /b 1
)
call :has_worktree_changes
if not errorlevel 1 (
  echo [WARNING] You have local changes. Git may refuse the update.
  set "CONFIRM_PULL="
  set /p "CONFIRM_PULL=Continue with a safe pull? (y/N): "
  if /i not "!CONFIRM_PULL!"=="y" exit /b 1
)
git pull --ff-only
if errorlevel 1 (
  echo [ERROR] Update stopped. No automatic merge was created.
  exit /b 1
)
echo [OK] Branch updated.
exit /b 0

:push_branch
call :current_branch_or_fail
if errorlevel 1 exit /b 1
call :has_worktree_changes
if not errorlevel 1 (
  echo [WARNING] Files that are not committed will NOT be sent.
  git status --short
  echo.
)
call :has_upstream
if errorlevel 1 (
  set "CONFIRM_PUBLISH="
  set /p "CONFIRM_PUBLISH=Create branch !CURRENT_BRANCH! on GitHub? (y/N): "
  if /i not "!CONFIRM_PUBLISH!"=="y" exit /b 1
  git push --set-upstream origin "!CURRENT_BRANCH!"
) else (
  git push
)
if errorlevel 1 (
  echo [ERROR] Push failed. Read the Git message above.
  exit /b 1
)
echo [OK] Commits sent to GitHub.
exit /b 0

:sync_dependencies
set "DEPENDENCIES_INSTALLED="
set "LOCK_HASH="
if exist "%ROOT%package-lock.json" (
  for /f "delims=" %%H in ('git hash-object "%ROOT%package-lock.json" 2^>nul') do set "LOCK_HASH=%%H"
)
set "SAVED_LOCK_HASH="
if exist "%LOCK_STAMP%" set /p "SAVED_LOCK_HASH="<"%LOCK_STAMP%"

if not exist "%ROOT%node_modules" goto :install_dependencies
if not defined LOCK_HASH goto :dependencies_ready
if /i "%LOCK_HASH%"=="%SAVED_LOCK_HASH%" goto :dependencies_ready

:install_dependencies
echo [INFO] Updating npm packages for this branch...
call npm install
if errorlevel 1 (
  echo [ERROR] npm install failed.
  exit /b 1
)
set "DEPENDENCIES_INSTALLED=1"
if defined LOCK_HASH >"%LOCK_STAMP%" echo %LOCK_HASH%

:dependencies_ready
exit /b 0

:print_git_summary
set "CURRENT_BRANCH=detached HEAD"
for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%B"
set "SHORT_HEAD=unknown"
for /f "delims=" %%H in ('git rev-parse --short HEAD 2^>nul') do set "SHORT_HEAD=%%H"
set "WORKTREE_LABEL=clean"
call :has_worktree_changes
if not errorlevel 1 set "WORKTREE_LABEL=changed files"
echo   Branch: !CURRENT_BRANCH!  -  Commit: !SHORT_HEAD!  -  Files: !WORKTREE_LABEL!
exit /b 0

:current_branch_or_fail
set "CURRENT_BRANCH="
for /f "delims=" %%B in ('git branch --show-current 2^>nul') do set "CURRENT_BRANCH=%%B"
if not defined CURRENT_BRANCH (
  echo [ERROR] No active branch. Git is in detached HEAD mode.
  exit /b 1
)
exit /b 0

:has_upstream
git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" >nul 2>&1
exit /b %ERRORLEVEL%

:has_worktree_changes
git diff --quiet --ignore-submodules -- 2>nul || exit /b 0
git diff --cached --quiet --ignore-submodules -- 2>nul || exit /b 0
for /f "delims=" %%F in ('git ls-files --others --exclude-standard 2^>nul') do exit /b 0
exit /b 1

:find_listener
set "LISTENER_PID="
for /f "tokens=5" %%P in ('netstat -ano -p tcp 2^>nul ^| findstr /r /c:":%~1 .*LISTENING"') do (
  if not defined LISTENER_PID set "LISTENER_PID=%%P"
)
exit /b 0

:show_process
powershell -NoProfile -Command "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=%~1' -ErrorAction SilentlyContinue; if($p){Write-Host ('[INFO] Process: ' + $p.Name + '  ' + $p.CommandLine)}"
exit /b 0

:wait_for_http
rem A dot every 5 seconds: without it a long first run looks like a frozen window.
powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(%~2); $tick=0; do { try { $r=Invoke-WebRequest -UseBasicParsing -Uri '%~1' -TimeoutSec 2; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 500){Write-Host ''; exit 0} } catch {}; Start-Sleep -Milliseconds 500; $tick++; if($tick %% 10 -eq 0){Write-Host -NoNewline '.'} } while((Get-Date) -lt $deadline); Write-Host ''; exit 1"
exit /b %ERRORLEVEL%

:require_command
where "%~1" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] %~2 was not found in PATH.
  exit /b 1
)
exit /b 0

:fatal_root
echo [ERROR] Could not open the NetsuBoard folder.

:failed
echo.
echo The launcher stopped. It did not hide or remove your Git changes.
if "%~1"=="" pause
exit /b 1
