if (Meteor.isClient) {
  const scrumMasters = ["Jan","Shreyas","Tamino"]

  Template.app.helpers({
    scrumMasters() {
      return scrumMasters.join(', ');
    },
    scrumMaster() {
      return scrumMasters[(Math.floor((Date.now()/1e3/60/60/24+3)/7)+2) % scrumMasters.length];
    },
  });
}
