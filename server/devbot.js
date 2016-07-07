const scrumMasters = ["Jan", "Shreyas", "Tamino", "Noelia"]

scrumMaster = function() {
  return scrumMasters[(Math.floor((Date.now()/1e3/60/60/24+3)/7)+3) % scrumMasters.length];
};

github = new GitHub({
  version: '3.0.0',
});

github.authenticate({
  type: 'basic',
  username: process.env.GITHUB_AUTH_USR,
  password: process.env.GITHUB_AUTH_PWD,
});

jiraGet = function(rel) {
  return HTTP.get(process.env.JIRA_ROOT + 'rest/api/2/' + rel, {
    auth: process.env.JIRA_AUTH,
  }).data;
};

Meteor.setInterval(function(){
  const user = process.env.GITHUB_REPO_USR;
  const repo = process.env.GITHUB_REPO_NAME;
  const prs = github.pullRequests.getAll({user, repo});
  prs.map(pr => {
    const match = pr.title.match(/^shyf[- ](\d+)([- ](\d+))?$/i);
    if (match) {
      try {
        const number = pr.number;
        const issue = 'SHYF-' + match[1];
        const issueSuffix = match[3] ? '-' + match[3] : '';
        const summary = jiraGet('issue/' + issue).fields.summary;
        const title = issue + issueSuffix + ' - ' + summary;
        github.pullRequests.update({user, repo, number, title});
        console.log(`updated PR #${number} with title '${pr.title}' to '${title}'`);
      } catch (e) {
        console.log(e);
      }
    }
  });
}, 1000 * 60);

bot = new SlackBot({
    token: process.env.SLACK_TOKEN,
    name: 'Marvin',
});

SyncedCron.add({
  log: true,
  name: 'Standup',
  timezone: 'Europe/Berlin',
  schedule(parser) {
    this.bot = bot;
    return parser.text('at 9:55am every weekday');
  },
  job() {
    return this.bot.postMessageToChannel('programming', 'Prepare for StandUp - Scrum Master is `' + scrumMaster() + '`');
  },
});

SyncedCron.start();

formatIssue = function(issue, showStatus = false) {
  res = '';
  const link = process.env.JIRA_ROOT + 'browse/' + issue.key;
  res += `> *${issue.key}* <${link}|${issue.fields.summary}>`
  if (showStatus && issue.fields.status.name !== 'Done') {
    res += ' - `' + issue.fields.status.name + '`';
  }
  return res + '\n';
};

bot.on('message', Meteor.bindEnvironment(function(data) {
  // console.log(data);
  if (data.type === 'message' && (data.subtype === undefined || data.subtype === 'message_changed')) {
    const text = data.text || data.message.text || '';
    const channel = data.channel;
    const issueMatch = text.match(/shyf[- ](\d+)/gi);
    if (issueMatch) {
      issueMatch.map(hit => {
        const issue = 'SHYF-' + hit.match(/^shyf[- ](\d+)$/i)[1];
        const summary = jiraGet('issue/' + issue).fields.summary;
        const link = process.env.JIRA_ROOT + 'browse/' + issue;
        const message = `*${issue}* - <${link}|${summary}>`;
        bot.postMessage(channel, message);
      });
    }
    const releaseMatch = text.match(/release/gi);
    if (releaseMatch) {
      jiraGet('project/SHYF/versions').map(version => {
        if (text.includes(version.name)) {
          let message = '';
          const issues = jiraGet('search?jql=fixversion=' + version.name).issues;
          const groupedByType = _.groupBy(issues, issue => issue.fields.issuetype.name);
          for (const issueType in groupedByType) {
            message += `\n*${issueType}*\n`;
            groupedByType[issueType].map(issue => (message += formatIssue(issue, true)));
          }
          const groupedByAssignee = _.groupBy(issues, issue => ((issue.fields.assignee && issue.fields.assignee.displayName) || 'unassigned'));
          for (const name in groupedByAssignee) {
            const todoIssues = _.filter(groupedByAssignee[name], issue => (issue.fields.status.name === 'To Do'));
            const progressIssues = _.filter(groupedByAssignee[name], issue => (issue.fields.status.name === 'In Progress'));
            const reviewIssues = _.filter(groupedByAssignee[name], issue => (issue.fields.status.name === 'In Review'));
            const doneIssues = _.filter(groupedByAssignee[name], issue => (issue.fields.status.name === 'Done'));
            const getHours = function(issues) {
              return _.reduce(issues, (memo, issue) => {
                return memo + (issue.fields.timeoriginalestimate || 0 );
              }, 0) / (60 * 60);
            };
            const todoHours = getHours(todoIssues);
            const progressHours = getHours(progressIssues);
            const reviewHours = getHours(reviewIssues);
            const doneHours = getHours(doneIssues);
            const totalHours = todoHours + progressHours + reviewHours + doneHours;
            if (totalHours > 0) {
              message += `\n\n*${name}*\n`;
              message += `Open: \`${todoHours + progressHours}\`h `;
              message += `Rev.: \`${reviewHours}\`h `;
              message += `Done: \`${doneHours}\`h `;
              message += `*Total*: \`${totalHours}\`h `;
            }
          }
          bot.postMessage(channel, message);
        }
      });
    }
    const sprintMatch = text.match(/sprint status/ig);
    if (sprintMatch) {
      let message = '';
      const issues = jiraGet('search?maxResults=1000&jql=sprint in openSprints()').issues;
      const groupedByAssignee = _.groupBy(issues, issue => ((issue.fields.assignee && issue.fields.assignee.displayName) || 'unassigned'));
      for (const name in groupedByAssignee) {
        message += `\n\n*${name}*\n`;
        const todoIssues = _.filter(groupedByAssignee[name], issue => (issue.fields.status.name === 'To Do' && issue.fields.issuetype.name !== 'Technical task'));
        const progressIssues = _.filter(groupedByAssignee[name], issue => (issue.fields.status.name === 'In Progress' && issue.fields.issuetype.name !== 'Technical task'));
        const reviewIssues = _.filter(groupedByAssignee[name], issue => (issue.fields.status.name === 'In Review' && issue.fields.issuetype.name !== 'Technical task'));
        const doneIssues = _.filter(groupedByAssignee[name], issue => (issue.fields.status.name === 'Done' && issue.fields.issuetype.name !== 'Technical task'));
        message += '\n_Summary:_\n';
        message += '> Todo: `' + todoIssues.length + '`\n';
        message += '> Prog: `' + progressIssues.length + '`\n';
        message += '> Rev.: `' + reviewIssues.length + '`\n';
        message += '> Done: `' + doneIssues.length + '`\n';
        message += '\n*Todo*\n';
        todoIssues.map(issue => (message += formatIssue(issue)));
        message += '*Progress*\n';
        progressIssues.map(issue => (message += formatIssue(issue)));
        message += '*Review*\n';
        reviewIssues.map(issue => (message += formatIssue(issue)));
        message += '*Done*\n';
        doneIssues.map(issue => (message += formatIssue(issue)));
      }
      bot.postMessage(channel, message);
    }
    const scrumMatch = text.match(/who ?is ?scrum ?master/ig);
    if (scrumMatch) {
      bot.postMessage(channel, 'Current Scrum Master is `' + scrumMaster() + '`');
    }
    const helloMatch = text.match(/hey devbot/ig) || text.match(/hey marvin/ig);
    if (helloMatch) {
      bot.postMessage(channel, 'Life. Don`t talk to me about life.');
    }
  }
}));
